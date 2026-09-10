// Pure selection/reset-arming state transitions. Spec F04 (row selection),
// F20 (double-press Reset), F24 (Deselect), F25 (filtered-out rows lose
// selection).
//
// State lives outside the DOM: `{selected}`, a Set of row IDs
// (results-model.js's rowId). kerning.js renders from this state; it never
// treats DOM state as the source of truth.
//
// One layer, not two. There used to be a separate tick layer with a checkbox
// per row: a row could be selected for preview and ticked for an action
// independently. Click and shift-click say enough, so what is selected is
// what an action acts on, and a row carries no checkbox at all.

// Ordinary click: select this row alone. With `additive` (Ctrl or Cmd):
// toggle this row in and out of the selection, leaving the rest alone.
export function selectRow(state, id, additive) {
  const selected = additive ? new Set(state.selected) : new Set();
  if (additive && selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }
  return { selected };
}

// Shift-click: the run from the anchor to here, over the order the rows are
// drawn in. Replaces the selection rather than adding to it, which is what
// makes a second shift-click able to shrink the run it just grew. An anchor
// or a target that is not on screen leaves the selection as it was.
export function selectRange(state, anchorId, id, orderedIds) {
  const from = orderedIds.indexOf(anchorId);
  const to = orderedIds.indexOf(id);
  if (from < 0 || to < 0) {
    return { selected: new Set(state.selected) };
  }
  const [low, high] = from <= to ? [from, to] : [to, from];
  return { selected: new Set(orderedIds.slice(low, high + 1)) };
}

// F25: a row that leaves the displayed result set loses its selection.
// `ids` is the set of currently-visible row IDs.
export function retainVisible(state, ids) {
  return { selected: new Set([...state.selected].filter((id) => ids.has(id))) };
}

// F24: Deselect clears the selection; its scope is selection only.
export function deselectAll() {
  return { selected: new Set() };
}

// F20: Reset selected writes explicit 0 and requires two presses on an
// UNCHANGED target set. `armedKey` is opaque state the caller stores
// between presses (null when disarmed); `targetIds` is the selected-row ID
// list at press time. Changing the selection between presses (or selecting
// nothing) means the next press only arms again, it never commits against a
// different set than the one that was shown.
export function pressReset(armedKey, targetIds) {
  if (!targetIds.length) {
    return { commit: false, armedKey: null };
  }
  const key = JSON.stringify([...new Set(targetIds)].sort());
  return key === armedKey
    ? { commit: true, armedKey: null }
    : { commit: false, armedKey: key };
}
