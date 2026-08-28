// The only write path for the markers section. The panel, the marker tool and the
// pointer tool all come through here; nothing else in the tree touches the stored
// section (Global Constraints).
//
// Every function folds one mutation across all editable layers into a single undo item,
// in the shape skeleton-panel-edits.js already has. That is what puts the same marker id
// in every source selected for editing.
//
// Placement is the exception: a new marker goes to the active source alone.

import { recordChanges } from "@fontra/core/change-recorder.js";
import { ChangeCollector } from "@fontra/core/changes.js";
import {
  allocateMarkerId,
  computeMarkerSignature,
  getMarkerData,
  getMarkerGroups,
  getMarkers,
  setMarkerData,
  withAnchorPosition,
} from "@fontra/core/marker-model.js";

export const MARKER_EDIT_SENDER = { senderID: "marker-editing" };

// Read-modify-write of the whole section. The section is small and flat, so a read of
// the whole thing and a write of the whole thing is honest and cheap; a partial write is
// what lets an address and its signature disagree.
function mutateMarkerData(layerGlyph, mutate) {
  const data = getMarkerData(layerGlyph) || { markers: [], groups: [] };
  const working = {
    ...data,
    markers: [...(data.markers || [])],
    groups: [...(data.groups || [])],
  };
  if (mutate(working) === false) {
    return;
  }
  setMarkerData(layerGlyph, working);
}

export async function runMarkerEdit(
  sceneController,
  undoLabel,
  applyToLayer,
  { editLayerOnly = false } = {}
) {
  return await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    const editingLayers = sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
    const entries = Object.entries(editingLayers);
    if (!entries.length) {
      return;
    }
    const editLayerName = sceneController.sceneSettings?.editLayerName;
    const editLayerGlyph = editingLayers[editLayerName] || entries[0][1];

    const allChanges = [];
    for (const [layerName, layerGlyph] of entries) {
      if (editLayerOnly && layerGlyph !== editLayerGlyph) {
        continue;
      }
      const changes = recordChanges(layerGlyph, (proxy) => {
        mutateMarkerData(proxy, (data) => applyToLayer(data, proxy));
      });
      allChanges.push(changes.prefixed(["layers", layerName, "glyph"]));
    }

    const combined = new ChangeCollector().concat(...allChanges);
    await sendIncrementalChange(combined.change);
    return { changes: combined, undoLabel, broadcast: true };
  }, MARKER_EDIT_SENDER);
}

// Placement. The id is allocated once, against the edit layer, and the same id is
// written wherever the marker lands — that is what makes multi-source copies of one
// marker recognisable as one marker.
export async function placeMarker(
  sceneController,
  makeMarker,
  undoLabel = "Place Marker"
) {
  let id;
  return await runMarkerEdit(
    sceneController,
    undoLabel,
    (data, layerGlyph) => {
      id ??= allocateMarkerId(layerGlyph);
      const marker = makeMarker(id, layerGlyph);
      if (!marker) {
        return false;
      }
      data.markers.push({ ...marker, id });
    },
    { editLayerOnly: true }
  );
}

export async function deleteMarkers(sceneController, ids, undoLabel = "Delete Marker") {
  const doomed = new Set(ids);
  return await runMarkerEdit(sceneController, undoLabel, (data) => {
    data.markers = data.markers.filter((marker) => !doomed.has(marker.id));
  });
}

export async function setMarkerTarget(sceneController, id, target) {
  return await runMarkerEdit(sceneController, "Set Marker Target", (data) => {
    data.markers = data.markers.map((marker) =>
      marker.id === id ? withTarget(marker, target) : marker
    );
  });
}

function withTarget(marker, target) {
  const next = { ...marker };
  if (target === undefined || target === null || target === "") {
    delete next.target;
  } else {
    next.target = target;
  }
  return next;
}

// The address and the signature are one write, always. A marker holding an address from
// one moment and a signature from another is exactly what the stale check reads as a
// broken anchor, so there is no way to write one without the other.
export async function reanchorMarkerEnd(
  sceneController,
  id,
  endIndex,
  end,
  flattenedPath,
  undoLabel = "Re-anchor Marker"
) {
  const signature = computeMarkerSignature(flattenedPath);
  return await runMarkerEdit(sceneController, undoLabel, (data) => {
    data.markers = data.markers.map((marker) => {
      if (marker.id !== id) {
        return marker;
      }
      const ends = [...marker.ends];
      ends[endIndex] = end;
      return { ...marker, ends, signature };
    });
  });
}

export async function setMarkerGroup(sceneController, id, groupId) {
  return await runMarkerEdit(sceneController, "Set Marker Group", (data) => {
    data.markers = data.markers.map((marker) => {
      if (marker.id !== id) {
        return marker;
      }
      const next = { ...marker };
      if (groupId) {
        next.groupId = groupId;
      } else {
        delete next.groupId;
      }
      return next;
    });
  });
}

export async function createGroup(sceneController, name) {
  let id;
  return await runMarkerEdit(sceneController, "Create Marker Group", (data) => {
    id ??= `group${(data.nextGroupId || 0) + 1}`;
    data.nextGroupId = (data.nextGroupId || 0) + 1;
    data.groups.push({ id, name, visible: true });
  });
}

export async function renameGroup(sceneController, id, name) {
  return await runMarkerEdit(sceneController, "Rename Marker Group", (data) => {
    data.groups = data.groups.map((group) =>
      group.id === id ? { ...group, name } : group
    );
  });
}

// Deleting a group leaves its markers alone and ungrouped. A group is a visibility
// switch, not an owner.
export async function deleteGroup(sceneController, id) {
  return await runMarkerEdit(sceneController, "Delete Marker Group", (data) => {
    data.groups = data.groups.filter((group) => group.id !== id);
    data.markers = data.markers.map((marker) => {
      if (marker.groupId !== id) {
        return marker;
      }
      const next = { ...marker };
      delete next.groupId;
      return next;
    });
  });
}

export async function setGroupVisible(sceneController, id, visible) {
  return await runMarkerEdit(sceneController, "Toggle Marker Group", (data) => {
    data.groups = data.groups.map((group) =>
      group.id === id ? { ...group, visible } : group
    );
  });
}

export function markerIsVisible(layerGlyph, marker) {
  if (!marker.groupId) {
    return true;
  }
  const group = getMarkerGroups(layerGlyph).find((g) => g.id === marker.groupId);
  return group ? group.visible !== false : true;
}

export function getVisibleMarkers(layerGlyph) {
  return getMarkers(layerGlyph).filter((marker) => markerIsVisible(layerGlyph, marker));
}

// Dragging a placed marker.
//
// A ray drags along the outline, not across the glyph: the anchor is a point on a curve,
// so each frame runs the same nearest-hit the placement ran and writes whatever segment
// and parameter come back. Crossing into the neighbouring segment is therefore ordinary,
// and nothing special happens at the joint.
//
// The drag is restricted to the contour it started on. Unrestricted, the anchor would
// jump to whatever outline happened to pass nearer the cursor. To move a marker to
// another contour, delete it and place a new one.
//
// Every frame is recorded against the state captured at mouse-down, never against the
// live glyph, so a rollback is a statement about the whole gesture rather than about its
// last frame.
export async function handleMarkerDrag({
  sceneController,
  eventStream,
  initialEvent,
  markerId,
  endIndex,
}) {
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return;
  }
  const glyphController = positionedGlyph.glyph;
  const startMarker = getMarkers(
    sceneController.sceneModel._getEditLayerGlyph(positionedGlyph)
  ).find((marker) => marker.id === markerId);
  if (!startMarker) {
    return;
  }
  const draggedEndIndex =
    endIndex ?? startMarker.ends.findIndex((end) => end.kind !== "cast");
  const startEnd = startMarker.ends[draggedEndIndex];
  const isRay = startMarker.ends.some((end) => end.kind === "cast");
  if (isRay && startEnd.kind === "skeletonPoint") {
    // A ray anchored on a skeleton point is dragged as a skeleton point, not here.
    return;
  }

  const signature = computeMarkerSignature(glyphController.flattenedPath);
  const hitTester = glyphController.flattenedPathHitTester;

  await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    const layerInfo = Object.entries(
      sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
    ).map(([layerName, layerGlyph]) => ({
      layerGlyph,
      changePath: ["layers", layerName, "glyph"],
    }));
    if (!layerInfo.length) {
      return;
    }

    let accumulated = new ChangeCollector();
    let dragged = false;

    for await (const event of eventStream) {
      if (event.type === "mouseup") {
        break;
      }
      if (event.type !== "mousemove") {
        continue;
      }
      const point = sceneController.localPoint(event);
      // A ray goes wherever it is dragged — onto another contour, or off the outline
      // altogether. The magnet does the resisting, not a restriction: a marker held to
      // the contour it happened to start on is one that cannot be moved somewhere more
      // useful, and a broken one has to be movable to be repairable at all.
      const newEnd = isRay
        ? nearestEndOnContour(
            hitTester,
            glyphController.flattenedPath,
            point,
            positionedGlyph
          )
        : nearestPointEnd(glyphController, point, positionedGlyph);
      if (!newEnd) {
        // A dimension end released on nothing stays where it was: both its ends name
        // points, and one dropped on empty space would name nothing.
        continue;
      }
      dragged = true;

      let frame = new ChangeCollector();
      for (const { layerGlyph, changePath } of layerInfo) {
        const layerChanges = recordChanges(layerGlyph, (proxy) => {
          mutateMarkerData(proxy, (data) => {
            data.markers = data.markers.map((marker) =>
              marker.id === markerId
                ? withEnd(startMarker, draggedEndIndex, newEnd, signature)
                : marker
            );
          });
        });
        frame = frame.concat(layerChanges.prefixed(changePath));
      }
      accumulated = accumulated.concat(frame);
      await sendIncrementalChange(frame.change, true);
    }

    if (!dragged || !accumulated.hasChange) {
      return;
    }
    return { changes: accumulated, undoLabel: "Move Marker", broadcast: true };
  }, MARKER_EDIT_SENDER);
}

// Re-anchoring repairs a marker, so it clears the declared break as well as writing the
// address and the signature. A marker dragged onto live geometry and still reading
// broken would be unfixable by the only gesture that fixes it.
function withEnd(marker, endIndex, end, signature) {
  const ends = [...marker.ends];
  ends[endIndex] = end;
  const repaired = { ...marker, ends, signature };
  delete repaired.broken;
  return repaired;
}

// Where a dragged ray lands. The outline is magnetic: within reach the marker takes hold
// of it and rides it, and past that reach it lets go and sits wherever it was dropped.
// A marker can therefore be moved from contour to contour, or left on empty canvas,
// which is what makes a broken one repairable and a placed one re-usable.
//
// The reach is in font units and is compared against the true nearest point on the
// outline, so the magnet grips a curve along its whole length, not only near its ends.
function nearestEndOnContour(hitTester, path, point, positionedGlyph) {
  const local = {
    x: point.x - positionedGlyph.x,
    y: point.y - positionedGlyph.y,
  };
  const hit = hitTester.findNearest(local);
  if (hit && hit.contourIndex !== undefined) {
    const distance = Math.hypot(hit.x - local.x, hit.y - local.y);
    if (distance <= MARKER_MAGNET_REACH) {
      return withAnchorPosition(
        {
          kind: "pathSegment",
          contourIndex: hit.contourIndex,
          segmentIndex: hit.segmentIndex,
          t: hit.t,
        },
        path
      );
    }
  }
  return { kind: "free", x: local.x, y: local.y };
}

function nearestPointEnd(glyphController, point, positionedGlyph) {
  const local = {
    x: point.x - positionedGlyph.x,
    y: point.y - positionedGlyph.y,
  };
  const path = glyphController.flattenedPath;
  let best;
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    const numPoints = path.getNumPointsOfContour(contourIndex);
    for (let pointIndex = 0; pointIndex < numPoints; pointIndex++) {
      const candidate = path.getContourPoint(contourIndex, pointIndex);
      const distance = Math.hypot(candidate.x - local.x, candidate.y - local.y);
      if (!best || distance < best.distance) {
        best = { distance, contourIndex, pointIndex };
      }
    }
  }
  if (!best || best.distance > MARKER_REANCHOR_RADIUS) {
    return undefined;
  }
  return withAnchorPosition(
    {
      kind: "pathPoint",
      contourIndex: best.contourIndex,
      pointIndex: best.pointIndex,
    },
    path
  );
}

// How near the outline a dragged marker has to be, in font units, before it takes hold
// of it. Beyond that it is free and sits wherever it is dropped. This is the magnet:
// inside the reach the marker resists being pulled off, past it the marker lets go.
const MARKER_MAGNET_REACH = 24;

// A dimension end re-anchors to a point it is released near, and to nothing otherwise.
const MARKER_REANCHOR_RADIUS = 30;
