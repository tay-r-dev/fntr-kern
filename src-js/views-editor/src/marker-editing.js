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

// Reverse contour is the one structural change that preserves the point count and the
// closed flag while moving the geometry out from under every address on that contour. So
// it declares those markers broken, in the same change that reverses. Declaring is
// honest; writing a signature that disagrees on purpose would be a signature that lies.
//
// Called from inside an existing recorded edit, so it mutates the layer glyph directly
// rather than opening an edit of its own.
export function breakMarkersOnContours(layerGlyph, contourIndices) {
  const affected = new Set(contourIndices);
  if (!affected.size) {
    return;
  }
  mutateMarkerData(layerGlyph, (data) => {
    let changed = false;
    data.markers = data.markers.map((marker) => {
      const touches = marker.ends.some(
        (end) =>
          (end.kind === "pathSegment" || end.kind === "pathPoint") &&
          affected.has(end.contourIndex)
      );
      if (!touches || marker.broken) {
        return marker;
      }
      changed = true;
      return { ...marker, broken: true };
    });
    return changed;
  });
}
