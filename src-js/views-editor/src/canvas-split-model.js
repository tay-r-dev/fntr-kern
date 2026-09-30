// The split canvas holds two panes. Each shows a canvas or the font overview.
// One canvas is live: the editor's own, which the panels and tools drive. The
// other canvas only shows its glyphs, and turns live when it is clicked.

export const PANE_CANVAS = "canvas";
export const PANE_OVERVIEW = "overview";

// The canvas that was whole stays live on the left; the new pane on the right
// opens on the overview, to pick its glyph.
export function splitPanes() {
  return { panes: [PANE_CANVAS, PANE_OVERVIEW], live: 0 };
}

// A glyph picked in a pane's overview opens there, and that pane is the one
// being worked in now.
export function openGlyphInPane(layout, index) {
  const panes = [...layout.panes];
  panes[index] = PANE_CANVAS;
  return { panes, live: index };
}

// The live canvas cannot sit under an overview while the other pane shows a
// canvas: that one takes over.
export function showOverviewInPane(layout, index) {
  const panes = [...layout.panes];
  panes[index] = PANE_OVERVIEW;
  const other = 1 - index;
  const live =
    layout.live === index && panes[other] === PANE_CANVAS ? other : layout.live;
  return { panes, live };
}

// The pane whose canvas fills the whole area once the split is gone. The other
// pane's canvas when there is one; else the live canvas, which is never lost.
export function closePane(layout, index) {
  const other = 1 - index;
  if (layout.panes[other] === PANE_CANVAS) {
    return other;
  }
  if (layout.panes[index] === PANE_CANVAS) {
    return index;
  }
  return layout.live;
}

// The first pane's share of the width. Each pane keeps at least minWidth px;
// a box too narrow for both splits evenly.
export function clampSplitRatio(ratio, width, minWidth) {
  if (width < 2 * minWidth) {
    return 0.5;
  }
  const min = minWidth / width;
  return Math.min(Math.max(ratio, min), 1 - min);
}

// What a pane keeps of a view: its text, its glyph and where it looks. The
// rest of the view (the location, the text settings) is the live one's, which
// both panes share.
export function paneStateFromViewInfo(viewInfo) {
  return {
    text: viewInfo.text ?? "",
    selectedGlyph: viewInfo.selectedGlyph ?? null,
    viewBox: viewInfo.viewBox ?? null,
  };
}

// Keys that only fit the glyph the live canvas shows: a pane that takes the
// live canvas starts without them.
const LIVE_GLYPH_KEYS = [
  "selection",
  "editLayerName",
  "editingLayers",
  "substituteGlyphName",
];

// The view a pane takes over the live canvas with: the live view, with the
// pane's own text, glyph and view in it.
export function paneViewInfo(liveInfo, paneState) {
  const info = { ...liveInfo };
  for (const key of LIVE_GLYPH_KEYS) {
    delete info[key];
  }
  info.text = paneState.text;
  info.selectedGlyph = paneState.selectedGlyph;
  if (paneState.viewBox) {
    info.viewBox = paneState.viewBox;
  } else {
    delete info.viewBox;
  }
  return info;
}

// Applying view info sets only the keys it carries. A key it leaves out gets
// its default here, so the view taken over replaces the old one whole. The
// view box is left out when missing: the canvas then frames the glyph itself.
export function completeViewInfo(viewInfo, persistentSettings, defaults) {
  const complete = {};
  for (const { key, infoKey } of persistentSettings) {
    const name = infoKey ?? key;
    if (viewInfo[name] !== undefined) {
      complete[name] = viewInfo[name];
      continue;
    }
    if (key === "viewBox") {
      continue;
    }
    const value = defaults[key];
    complete[name] =
      value instanceof Set || Array.isArray(value)
        ? []
        : value && typeof value === "object"
          ? {}
          : value;
  }
  return complete;
}
