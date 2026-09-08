// Pure highlight/tick/reset-arming state transitions. Spec F04 (two
// independent selection layers), F20 (double-press Reset), F24 (Deselect),
// F25 (filtered-out rows lose selection).
//
// State lives outside the DOM: `{highlighted, ticked}` Sets of row IDs
// (results-model.js's rowId). kerning.js renders from this state; it never
// treats checkbox/DOM state as the source of truth.

// Ordinary click: highlight this row alone. Shift-click (`additive`):
// toggle this row in/out of the highlighted set, never a range (spec F04
// table, row 2: "never select an intervening range").
export function selectRow(state, id, additive) {
  const highlighted = additive ? new Set(state.highlighted) : new Set();
  if (additive && highlighted.has(id)) {
    highlighted.delete(id);
  } else {
    highlighted.add(id);
  }
  return { highlighted, ticked: new Set(state.ticked) };
}

// F04 table: "Check a highlighted row -> check every highlighted row";
// "Check or uncheck an unhighlighted row -> change that row's tick only."
export function tickRow(state, id, checked) {
  const targets = state.highlighted.has(id) ? state.highlighted : [id];
  const ticked = new Set(state.ticked);
  for (const key of targets) {
    if (checked) {
      ticked.add(key);
    } else {
      ticked.delete(key);
    }
  }
  return { highlighted: new Set(state.highlighted), ticked };
}

// F25: a row that leaves the displayed result set loses both its highlight
// and its tick. `ids` is the set of currently-visible row IDs.
export function retainVisible(state, ids) {
  return {
    highlighted: new Set([...state.highlighted].filter((id) => ids.has(id))),
    ticked: new Set([...state.ticked].filter((id) => ids.has(id))),
  };
}

// F24: Deselect clears both layers; its scope is selection only.
export function deselectAll() {
  return { highlighted: new Set(), ticked: new Set() };
}

// F20: Reset selected writes explicit 0 and requires two presses on an
// UNCHANGED target set. `armedKey` is opaque state the caller stores
// between presses (null when disarmed); `targetIds` is the ticked-row ID
// list at press time. Changing the ticked set between presses (or ticking/
// unticking nothing) means the next press only arms again, it never
// commits against a different set than the one that was shown.
export function pressReset(armedKey, targetIds) {
  if (!targetIds.length) {
    return { commit: false, armedKey: null };
  }
  const key = JSON.stringify([...new Set(targetIds)].sort());
  return key === armedKey
    ? { commit: true, armedKey: null }
    : { commit: false, armedKey: key };
}
