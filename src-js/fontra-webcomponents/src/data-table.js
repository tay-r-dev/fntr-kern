import * as html from "@fontra/core/html-utils.js";
import {
  clampWindowStart,
  huggedColumnWidth,
  ownColumns,
  parseCellValue,
  parseStoredColumnWidths,
  resizedColumnWidth,
  scrollWindowShift,
  stepCellValue,
  windowEnd,
} from "./data-table-model.js";
import { attachScrollbars } from "./scrollbars.js";
import { smolDropdown, smolEntry, smolCSS } from "./smol.js";
import "./icon-button.js";
import { showMenu } from "./menu-panel.js";
import { selectRange, selectRow } from "./table-selection.js";
import { themeColorCSS } from "./theme-support.js";
import "./ui-handle.js";

// The shared table (UI-REFACTOR.md §3, UI-NOMENCLATURE.md §14). Ticket 04
// lifted its head, sort and select-all tick out of the kerning pair table.
// It now carries everything else that table does, so any view builds the same
// table from this file alone:
//
// - the head: sort headers, the select-all tick, a column menu on right-click
//   that shows and hides columns;
// - the rows: `setRows` renders an item list, all of it or a window that
//   slides as the box scrolls;
// - the box: an optional scroll region with a resize grip at its bottom edge;
// - selection: row IDs by click, Ctrl-click and Shift-click, drawn on the rows;
// - the cells: `editableCell`, `selectCell`, `rowAction`, `actionsCell`,
//   `copyableText`, which look like text until a row is hovered;
// - the styles for all of it, added to the document once.
//
// Light DOM, no shadow root: a caller's CSS keyed to its own class names on
// the table, rows and cells keeps matching. The built-in rules sit inside
// :where(), so any caller rule overrides them.
//
// Every addition is opt-in. A caller that builds its own tbody rows and sets
// nothing new gets the ticket 04 table.

const MAX_HIDEABLE_COLUMNS = 24;

// The space between fields that share a cell (a `fitText` list).
const FIT_FIELD_GAP = 2;

// The looks' colors (`look` = "data" or "select"). Light colours are the design
// system's tokens (core.css); dark ones stay hand-picked until the design has
// a dark mode.
const lookColors = {
  "data-table-look-background-color": ["var(--surface-base-basic-0)", "#2c2c2c"],
  "data-table-look-border-color": ["var(--line-base-basic-1)", "#3a3a3a"],
  "data-table-look-rule-color": ["var(--line-base-basic-0)", "rgba(255, 255, 255, 0.1)"],
  // The head's rule (Figma 4066:6350): line 1, a step darker than the rows'.
  "data-table-look-head-rule-color": [
    "var(--line-base-basic-1)",
    "rgba(255, 255, 255, 0.1)",
  ],
  "data-table-look-divider-color": [
    "var(--line-base-basic-1)",
    "rgba(255, 255, 255, 0.1)",
  ],
  "data-table-look-drag-divider-color": [
    "var(--line-base-basic-3)",
    "rgba(255, 255, 255, 0.2)",
  ],
  "data-table-look-heading-color": ["var(--text-base-basic-4)", "#8e8e8e"],
  "data-table-look-entry-color": ["var(--text-base-basic-3)", "#a8a8a8"],
  "data-table-look-entry-hover-color": ["var(--text-base-basic-2)", "#e0e0e0"],
  "data-table-look-entry-disabled-color": ["var(--text-base-basic-4)", "#5a5a5a"],
  "data-table-look-additional-color": ["var(--text-base-basic-4)", "#8e8e8e"],
  "data-table-look-additional-hover-color": ["var(--text-base-basic-3)", "#b4b4b4"],
  "data-table-look-additional-disabled-color": [
    "var(--text-base-basic-4)",
    "#5a5a5a",
  ],
  // A selected row in a table that does not have the focus: grey
  // (Figma 2004:29827, select=true focus=false).
  "data-table-look-selection-color": ["var(--surface-base-basic-1)", "#333333"],
  "data-table-look-selection-rule-color": ["var(--line-base-basic-1)", "#444444"],
  "data-table-look-selection-entry-color": ["var(--text-base-basic-3)", "#a8a8a8"],
  "data-table-look-selection-entry-hover-color": ["var(--text-base-basic-2)", "#e0e0e0"],
  "data-table-look-selection-additional-color": ["var(--text-base-basic-4)", "#8e8e8e"],
  "data-table-look-selection-additional-hover-color": [
    "var(--text-base-basic-3)",
    "#b4b4b4",
  ],
  // A selected row that is disabled (Figma 4289:1164): the pale lime fill with
  // no rule, and entries faded to a third.
  "data-table-look-disabled-selection-color": [
    "var(--surface-color-lime-basic-1)",
    "#2f3620",
  ],
  "data-table-look-disabled-selection-entry-color": [
    "color-mix(in srgb, var(--text-color-lime-basic-2) 34%, transparent)",
    "#5a6e1a",
  ],
  "data-table-look-disabled-selection-additional-color": [
    "color-mix(in srgb, var(--text-color-lime-basic-4) 30%, transparent)",
    "#4a5a20",
  ],
  "data-table-look-icon-color": ["var(--icon-base-basic-3)", "#6a6a6a"],
  "data-table-look-icon-hover-color": ["var(--icon-base-basic-2)", "#e0e0e0"],
  "data-table-look-icon-disabled-color": ["var(--icon-base-basic-4)", "#5a5a5a"],
};


// A selected row in the table that has the focus: lime (Figma 2004:29827,
// select=true focus=true). These replace the grey selection colours above.
const focusedSelectionColors = {
  "data-table-look-selection-color": ["var(--surface-color-lime-basic-1)", "#3a4220"],
  "data-table-look-selection-rule-color": ["var(--line-color-lime-basic-1)", "#5a6e1a"],
  "data-table-look-selection-entry-color": ["var(--text-color-lime-basic-3)", "#c4dc6a"],
  "data-table-look-selection-entry-hover-color": [
    "var(--text-color-lime-basic-1)",
    "#e2f38f",
  ],
  "data-table-look-selection-additional-color": [
    "color-mix(in srgb, var(--text-color-lime-basic-4) 50%, transparent)",
    "#8a9a5a",
  ],
  "data-table-look-selection-additional-hover-color": [
    "var(--text-color-lime-basic-3)",
    "#a9b97a",
  ],
  "data-table-look-selection-icon-color": ["var(--icon-color-lime-basic-3)", "#a9c915"],
  "data-table-look-selection-icon-hover-color": [
    "var(--icon-color-lime-basic-1)",
    "#a9c915",
  ],
  "data-table-look-selection-icon-active-color": [
    "var(--text-color-lime-basic-3)",
    "#c4dc6a",
  ],
  "data-table-look-selection-icon-press-color": [
    "var(--icon-color-lime-basic-2)",
    "#c4dc6a",
  ],
  "data-table-look-selection-icon-disabled-color": [
    "color-mix(in srgb, var(--icon-color-lime-basic-4) 50%, transparent)",
    "#5a6e1a",
  ],
  "data-table-look-selection-icon-hover-border-color": [
    "var(--line-color-lime-basic-1)",
    "#5a6e1a",
  ],
  "data-table-look-selection-icon-press-fill": [
    "var(--surface-color-lime-basic-2)",
    "#4a5a20",
  ],
  "data-table-look-selection-icon-press-border-color": [
    "var(--line-color-lime-basic-2)",
    "#5a6e1a",
  ],
};

const DATA_TABLE_STYLES = `
  :where(.data-table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
    user-select: none;
  }

  :where(.data-table th, .data-table td) {
    text-align: left;
    padding: 0.15em 0.4em;
    border-bottom: 1px solid var(--horizontal-rule-color, #ccc);
  }

  :where(.data-table .data-table-align-right) {
    text-align: right;
  }

  :where(.data-table.data-table-clickable tbody tr) {
    cursor: pointer;
  }

  :where(.data-table-sortable) {
    cursor: pointer;
    user-select: none;
  }

  :where(.data-table-sort-active) {
    font-weight: bold;
  }

  :where(.data-table-row-selected) {
    background-color: color-mix(in srgb, var(--foreground-color) 12%, transparent);
  }

  :where(.data-table [data-selectable-name]) {
    user-select: text;
  }

  /* Width stays weak, so a caller's own width class wins. */
  :where(.data-table-input, .data-table-select) {
    width: 100%;
  }

  /* Fields sharing a cell, side by side (FIT_FIELD_GAP apart). */
  :where(.data-table-fields) {
    display: flex;
    gap: ${FIT_FIELD_GAP}px;
  }

  /* The cells' entries and dropdowns are the smol box (smol.js). */
  ${smolCSS({
    hoverWithin: ".data-table tr",
    selectedWithin: "data-table:hover .data-table-row-selected",
  })}

  /* A table's dropdown is as wide as its widest choice whatever is picked,
     so the column never jumps with the pick. */
  .data-table select.smol {
    field-sizing: fixed;
  }

  :where(.data-table-action) {
    display: inline-flex;
    vertical-align: middle;
  }

  :where(.data-table-reveal-hover) {
    opacity: 0;
    pointer-events: none;
  }

  :where(.data-table tr:hover .data-table-reveal-hover,
    .data-table tr:focus-within .data-table-reveal-hover) {
    opacity: 0.35;
    pointer-events: auto;
  }

  :where(.data-table-reveal-dim) {
    opacity: 0.35;
  }

  :where(.data-table tr:hover .data-table-reveal-hover:hover,
    .data-table tr:hover .data-table-reveal-dim,
    .data-table tr:focus-within .data-table-reveal-dim) {
    opacity: 1;
  }

  :where(.data-table-actions) {
    display: flex;
    gap: 1px;
    justify-content: flex-end;
    align-items: center;
  }

  :where(data-table.data-table-scrollable) {
    display: block;
  }

  :where(data-table.data-table-scrollable > .data-table-scroll) {
    height: var(--data-table-height, 320px);
    overflow-y: auto;
  }

  /* The head stays put while the rows scroll under it, above any cell a
     caller pins sideways. The position is not inside :where(): the head
     cells' own position: relative (for the column grip) comes later and
     would win a tie. */
  :where(data-table.data-table-scrollable thead th) {
    background-color: var(--background-color, #fff);
  }

  :where(data-table.data-table-scrollable) thead th {
    position: sticky;
    top: 0;
    z-index: 2;
  }

  /* The grip is the handle (Figma 379:22492) standing on the box's bottom
     edge, over the last row. The row keeps room for it. */
  :where(.data-table-grip) {
    height: 0;
    position: relative;
    z-index: 1;
  }

  :where(.data-table-grip) > ui-handle {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
  }

  :where(data-table.data-table-resizable tbody tr:last-child td) {
    padding-bottom: calc(0.15em + 6px);
  }

  /* Column resize (columnWidthsStorageKey): a handle on each head cell's
     right edge; a hairline shows on hover and while dragging. */
  :where(.data-table th) {
    position: relative;
  }

  .data-table-column-grip {
    position: absolute;
    /* Inside the cell, which may clip what overflows it. */
    top: 0;
    right: 0;
    bottom: 0;
    width: 6px;
    z-index: 2;
    cursor: col-resize;
    touch-action: none;
  }

  .data-table-column-grip::after {
    content: "";
    position: absolute;
    top: 4px;
    bottom: 4px;
    right: 0;
    width: 1px;
    background: currentColor;
    opacity: 0;
  }

  .data-table-column-grip:hover::after,
  .data-table-column-grip.dragging::after {
    opacity: 0.35;
  }

  :root.data-table-column-resizing {
    user-select: none;
    -webkit-user-select: none;
    cursor: col-resize;
  }

  :root.data-table-resizing {
    user-select: none;
    -webkit-user-select: none;
    cursor: row-resize;
  }

  /* A row's marker (the design's 2px stripe down its first cell's left
     edge), in any look. */
  :where(.data-table tr.data-table-row-marked > td:first-child) {
    position: relative;
  }

  :where(.data-table tr.data-table-row-marked > td:first-child)::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: -1px;
    width: 2px;
    background: var(--data-table-marker-color, #ed6a3a);
  }

  :where(.data-table-status) {
    box-sizing: border-box;
    height: 18px;
    width: 100%;
    min-width: 31px;
    border: 1px solid var(--data-table-look-background-color, #fff);
    border-radius: 4px;
  }

  ${themeColorCSS(lookColors, "data-table")}

  ${themeColorCSS(focusedSelectionColors, "data-table:hover")}

  /* The looks (table, Figma 2004:29827): a white box, ruled and rounded; a
     24px head of small uppercase light grey labels over a rule; 24px rows of
     thin grey entries. "data" rules every row, "select" only the selected
     ones; the rest is shared. A hovered row darkens its text and
     shows its icons and its editable box; a selected row is lime-filled with
     a lime rule and lime text; a disabled row is pale. */
  data-table[look] > .data-table-scroll {
    box-sizing: border-box;
    border: 1px solid var(--data-table-look-border-color);
    border-radius: 6px;
    background-color: var(--data-table-look-background-color);
    /* A column dragged wider than the box scrolls sideways. */
    overflow-x: auto;
  }

  /* A table without a height of its own scrolls only sideways, with a
     strip kept under its rows for that bar (_updateScrollReserve); one
     whose height is set scrolls both ways inside it. */
  data-table[look] > .data-table-scroll:focus {
    outline: none;
  }

  data-table[look]:not(.data-table-scrollable) > .data-table-scroll {
    overflow-y: hidden;
  }

  data-table[look] .data-table {
    font-size: inherit;
  }

  data-table[look] .data-table th,
  data-table[look] .data-table td {
    padding: 0 8px;
    white-space: nowrap;
    vertical-align: middle;
    border-bottom: 1px solid var(--data-table-look-rule-color);
  }

  /* A cell keeps its column's width; what does not fit ends in an
     ellipsis. The actions are left whole: their buttons sit over the rule. */
  data-table[look] .data-table th,
  data-table[look] .data-table td:not(:has(> .data-table-actions)) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A collapsed border does not travel with a sticky head, so the head's
     rule is drawn inside it instead. */
  data-table[look] .data-table th {
    background-color: var(--data-table-look-background-color);
    border-bottom: none;
    box-shadow: inset 0 -1px var(--data-table-look-head-rule-color);
  }

  /* ui/table/heading */
  data-table[look] .data-table th {
    height: var(--height-l);
    box-sizing: border-box;
    font: var(--ui-text-table-heading);
    letter-spacing: var(--ui-tracking-table-heading);
    text-transform: uppercase;
    color: var(--data-table-look-heading-color);
  }

  /* The head's dividers (html-utils.js's trackHeadDividers): one per
     boundary between two head cells, drawn by the cell on its left, its full
     height -- line 3 where that edge can be dragged, line 1 where it
     cannot. The grips draw no line of their own. */
  data-table[look] .data-table thead th {
    --data-table-divider: var(--data-table-look-divider-color);
  }

  data-table[look] .data-table thead th.data-table-drag-right {
    --data-table-divider: var(--data-table-look-drag-divider-color);
  }

  data-table[look] .data-table thead th.data-table-divider-shown {
    background-image: linear-gradient(var(--data-table-divider), var(--data-table-divider));
    background-size: 1px 100%;
    background-position: right center;
    background-repeat: no-repeat;
  }

  data-table[look] .data-table-column-grip::after {
    display: none;
  }

  /* The sort is told by its arrow; the head keeps one colour. */
  data-table[look] .data-table th.data-table-sort-active {
    font-weight: 400;
  }

  /* ui/label/XS */
  data-table[look] .data-table td {
    height: var(--height-l);
    box-sizing: border-box;
    font: var(--ui-text-label-xs);
    letter-spacing: var(--ui-tracking);
    font-feature-settings: "case" 1;
    color: var(--data-table-look-entry-color);
  }

  data-table[look] .data-table tbody tr:last-child td {
    border-bottom: none;
  }

  /* A "select" table (source layers, glyph sets) has no underline on its
     unselected rows (Figma 4062:1055's note); a "data" table keeps them. */
  data-table[look="select"] .data-table tbody tr:not(.data-table-row-selected) td {
    border-bottom-color: transparent;
  }

  /* A selected row is lined in lime above and below (Figma 2004:29833). In
     a collapsed table the line above it is the previous row's rule, so that
     rule turns lime. */
  data-table[look]
    .data-table
    tbody
    tr:not(.data-table-row-selected):has(+ tr.data-table-row-selected)
    td {
    border-bottom-color: var(--data-table-look-selection-rule-color);
  }

  /* The first row has no row above: its top line is drawn inside it. */
  data-table[look] .data-table tbody tr.data-table-row-selected:first-child td {
    box-shadow: inset 0 1px var(--data-table-look-selection-rule-color);
  }

  /* A selected row's marker covers its top line too. */
  data-table[look] .data-table tr.data-table-row-selected.data-table-row-marked > td:first-child::before {
    top: -1px;
  }

  data-table[look].data-table-resizable .data-table tbody tr:last-child td {
    height: 38px;
    padding-bottom: 12px;
  }

  data-table[look] .data-table-additional {
    margin-left: 4px;
    color: var(--data-table-look-additional-color);
  }

  /* Hover */
  data-table[look] .data-table tbody tr:hover td {
    color: var(--data-table-look-entry-hover-color);
  }

  data-table[look] .data-table tbody tr:hover .data-table-additional {
    color: var(--data-table-look-additional-hover-color);
  }

  /* Selection (active), and selection hover */
  data-table[look] .data-table tr.data-table-row-selected td {
    background-color: var(--data-table-look-selection-color);
    border-bottom-color: var(--data-table-look-selection-rule-color);
    color: var(--data-table-look-selection-entry-color);
  }

  data-table[look] .data-table tr.data-table-row-selected .data-table-additional {
    color: var(--data-table-look-selection-additional-color);
  }

  data-table[look] .data-table tbody tr.data-table-row-selected:hover td {
    color: var(--data-table-look-selection-entry-hover-color);
  }

  data-table[look]
    .data-table
    tbody
    tr.data-table-row-selected:hover
    .data-table-additional {
    color: var(--data-table-look-selection-additional-hover-color);
  }

  /* The rule under a selected row is the lime one even where the next row
     would draw over it: the last row keeps it too. */
  data-table[look] .data-table tbody tr.data-table-row-selected:last-child td {
    border-bottom: 1px solid var(--data-table-look-selection-rule-color);
  }

  /* button/table's "select" variant on a selected row: lime icons, a lime
     edge on hover, a lime face while pressed. */
  data-table[look]:hover tr.data-table-row-selected icon-button {
    --icon-button-icon-color: var(--data-table-look-selection-icon-color);
    --icon-button-icon-hover-color: var(--data-table-look-selection-icon-hover-color);
    --icon-button-icon-active-color: var(
      --data-table-look-selection-icon-active-color
    );
    /* The badge's ring is the selected row's fill. */
    --ind-bdg-ln-outside: var(--data-table-look-selection-color);
    --icon-button-icon-press-color: var(--data-table-look-selection-icon-press-color);
    --icon-button-icon-disabled-color: var(
      --data-table-look-selection-icon-disabled-color
    );
    --icon-button-table-hover-border-color: var(
      --data-table-look-selection-icon-hover-border-color
    );
    --icon-button-press-background-color: var(--data-table-look-selection-icon-press-fill);
    --icon-button-press-border-color: var(
      --data-table-look-selection-icon-press-border-color
    );
  }

  /* Disabled: pale text and icons, no hover. */
  data-table[look] .data-table tr.data-table-row-disabled td,
  data-table[look] .data-table tr.data-table-row-disabled:hover td {
    color: var(--data-table-look-entry-disabled-color);
  }

  data-table[look] .data-table tr.data-table-row-disabled .data-table-additional {
    color: var(--data-table-look-additional-disabled-color);
  }

  data-table[look] tr.data-table-row-disabled icon-button {
    --icon-button-icon-color: var(--icon-button-icon-disabled-color);
    pointer-events: none;
  }

  data-table[look] tr.data-table-row-disabled .data-table-status {
    opacity: 0.3;
  }

  /* A selected row that is disabled: pale lime, no rule, faded text, and no
     actions (Figma 4289:1164, 4289:1169, 4289:1174). */
  data-table[look] .data-table tr.data-table-row-disabled.data-table-row-selected td,
  data-table[look] .data-table tr.data-table-row-disabled.data-table-row-selected:hover td {
    background-color: var(--data-table-look-disabled-selection-color);
    border-bottom-color: transparent;
    box-shadow: none;
    color: var(--data-table-look-disabled-selection-entry-color);
  }

  data-table[look] .data-table tr.data-table-row-disabled.data-table-row-selected .data-table-additional {
    color: var(--data-table-look-disabled-selection-additional-color);
  }

  data-table[look] .data-table tr.data-table-row-disabled.data-table-row-selected .data-table-actions {
    opacity: 0;
  }

  /* The row's icons: button/table icon, a 16px slot with 4px corners
     around icon-button's 15px glyph; 4px apart. */
  /* button/table's 24px box over the row's own 24px: it lays over the
     row's rule rather than growing the row. */
  data-table[look] tbody icon-button {
    vertical-align: middle;
    --icon-button-inner-radius: 4px;
  }

  data-table[look] tbody icon-button:not([size="S"]) {
    margin-bottom: -1px;
  }

  /* A plain icon in a row is coloured like button/table: its rest colour
  whatever the row's hover, the select colour on a selected row. */
  data-table[look] tbody td > inline-svg,
  data-table[look] tbody td > span > inline-svg {
    color: var(--data-table-look-icon-color);
  }

  data-table[look] tbody td > inline-svg:hover,
  data-table[look] tbody td > span > inline-svg:hover {
    color: var(--data-table-look-icon-hover-color);
  }

  data-table[look]:hover tbody tr.data-table-row-selected td > inline-svg,
  data-table[look]:hover tbody tr.data-table-row-selected td > span > inline-svg {
    color: var(--data-table-look-selection-icon-color);
  }

  data-table[look]:hover tbody tr.data-table-row-selected td > inline-svg:hover,
  data-table[look]:hover tbody tr.data-table-row-selected td > span > inline-svg:hover {
    color: var(--data-table-look-selection-icon-hover-color);
  }

  data-table[look] tbody tr.data-table-row-disabled td > inline-svg,
  data-table[look] tbody tr.data-table-row-disabled td > span > inline-svg {
    color: var(--data-table-look-icon-disabled-color);
  }

  data-table[look] tbody td > inline-svg,
  data-table[look] tbody td > span > inline-svg {
    box-sizing: content-box;
    width: 15px;
    height: 15px;
    padding: 0.5px;
    vertical-align: middle;
  }

  data-table[look] .data-table-actions {
    gap: 1px;
  }

  data-table[look] tbody icon-button + icon-button {
    margin-left: 4px;
  }

  data-table[look] .data-table-actions icon-button + icon-button {
    margin-left: 0;
  }

  /* A row's own icon ("dim") is hidden at rest and shows on the row's
     hover, on a selected row and on a disabled one; the actions ("hover")
     show only on the hover. */
  data-table[look] .data-table-reveal-dim {
    opacity: 0;
  }

  data-table[look] tr:hover .data-table-reveal-hover,
  data-table[look] tr:focus-within .data-table-reveal-hover,
  data-table[look] tr:hover .data-table-reveal-dim,
  data-table[look] tr:focus-within .data-table-reveal-dim,
  data-table[look] tr.data-table-row-selected .data-table-reveal-dim,
  data-table[look] tr.data-table-row-disabled .data-table-reveal-dim {
    opacity: 1;
    pointer-events: auto;
  }

  ${Array.from(
    { length: MAX_HIDEABLE_COLUMNS },
    (_, index) =>
      `.data-table.data-table-hide-${index + 1} tr > :nth-child(${index + 1}) ` +
      `{ display: none; }`
  ).join("\n  ")}
`;

const styledRoots = new WeakSet();

// Styles go into the root the table is mounted in: the document's head, or a
// shadow root when the table sits inside a panel, where head styles never
// reach.
function addDataTableStyles(element) {
  const root = element.getRootNode();
  if (styledRoots.has(root)) {
    return;
  }
  styledRoots.add(root);
  html.addStyleSheet(
    DATA_TABLE_STYLES,
    root instanceof ShadowRoot ? root : document.head
  );
}

// A row. `rowId` is what selection, windowing and `onRowClick` know it by.
// `marker` draws the stripe down the first cell's left edge: true for the
// design's orange, or a CSS color. `disabled` draws the row pale.
export function tableRow(rowId, cells, { className, title, marker, disabled } = {}) {
  const tr = document.createElement("tr");
  if (rowId != null) {
    tr.dataset.rowId = rowId;
  }
  if (className) {
    tr.className = className;
  }
  if (disabled) {
    tr.classList.add("data-table-row-disabled");
  }
  if (marker) {
    tr.classList.add("data-table-row-marked");
    if (typeof marker === "string") {
      tr.style.setProperty("--data-table-marker-color", marker);
    }
  }
  if (title) {
    tr.title = title;
  }
  tr.append(...cells);
  return tr;
}

// A cell. `children` is a node, a string or a list of them.
export function tableCell(children = [], { className, align } = {}) {
  const td = document.createElement("td");
  if (className) {
    td.className = className;
  }
  if (align === "right") {
    td.classList.add("data-table-align-right");
  }
  td.append(...[children].flat().filter((child) => child != null));
  return td;
}

// An in-place editor that reads as text until its row is hovered. Enter
// commits, Escape restores, and a number cell commits only a number (or null
// for empty text, with `allowEmpty`).
// `onCommit(value)` runs only for a changed, valid value.
export function editableCell({
  value,
  type = "text",
  step,
  round = false,
  allowEmpty = false,
  title,
  placeholder,
  disabled = false,
  className,
  onCommit,
}) {
  const input = smolEntry({
    type,
    title,
    placeholder,
    disabled,
    className: className ? `data-table-input ${className}` : "data-table-input",
  });
  if (step != null) {
    input.step = String(step);
  }
  let committed = value ?? "";
  input.value = String(committed);
  input.addEventListener("keydown", (event) => {
    // A number cell steps with the arrow keys -- ten steps with Shift, which
    // the native field does not do -- and each step commits.
    if (
      type === "number" &&
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !input.disabled
    ) {
      event.preventDefault();
      input.value = String(
        stepCellValue(input.value, {
          step: step ?? 1,
          direction: event.key === "ArrowUp" ? 1 : -1,
          big: event.shiftKey,
        })
      );
      input.dispatchEvent(new Event("change"));
      return;
    }
    if (event.key === "Enter") {
      input.blur();
    } else if (event.key === "Escape") {
      // A half-typed value left in the box would be written by the blur.
      input.value = String(committed);
      input.blur();
    }
  });
  input.addEventListener("change", () => {
    const parsed = parseCellValue(input.value, { type, round, allowEmpty });
    if (!parsed.valid) {
      input.value = String(committed);
      return;
    }
    input.value = String(parsed.value);
    if (parsed.value === committed) {
      return;
    }
    committed = parsed.value;
    onCommit?.(parsed.value);
  });
  return input;
}

// A choice that reads as text until its row is hovered. `options` is
// [{value, label}].
export function selectCell({ value, options, disabled = false, className, onChange }) {
  return smolDropdown({
    value,
    options,
    disabled,
    className: className ? `data-table-select ${className}` : "data-table-select",
    onChange,
  });
}

// A row's icon action. `reveal` is "hover" (hidden until the row is hovered),
// "dim" (faint until then) or "always". A click acts and never selects the row.
export function rowAction({
  src,
  tooltip,
  label,
  onClick,
  reveal = "dim",
  disabled = false,
  className,
  tooltipPosition,
}) {
  const button = document.createElement("icon-button");
  button.className = "data-table-action";
  if (reveal === "hover" || reveal === "dim") {
    button.classList.add(`data-table-reveal-${reveal}`);
  }
  if (className) {
    button.classList.add(...className.split(" ").filter(Boolean));
  }
  button.src = src;
  // button/table at 16px, the size the rows' actions are drawn at.
  button.size = "S";
  if (label || tooltip) {
    button.setAttribute("aria-label", label || tooltip);
  }
  if (tooltip) {
    button.setAttribute("data-tooltip", tooltip);
  }
  if (tooltipPosition) {
    button.setAttribute("data-tooltipposition", tooltipPosition);
  }
  button.disabled = disabled;
  if (onClick) {
    button.onclick = (event) => {
      event.stopPropagation();
      onClick(event);
    };
  }
  return button;
}

// A right-aligned cell of row actions.
export function actionsCell(actions, { className } = {}) {
  const box = document.createElement("div");
  box.className = "data-table-actions";
  box.append(...actions.filter(Boolean));
  return tableCell([box], { className });
}

// The lighter text after a cell's entry (the design's "additional info").
export function additionalText(text) {
  const span = document.createElement("span");
  span.className = "data-table-additional";
  span.textContent = text;
  return span;
}

// A status cell's swatch (table "custom"): an 18px rounded box of
// `color` filling the cell.
export function statusSwatch(color, { title } = {}) {
  const swatch = document.createElement("div");
  swatch.className = "data-table-status";
  swatch.style.backgroundColor = color;
  if (title) {
    swatch.title = title;
  }
  return swatch;
}

// Text that a double-click makes selectable, so a name can be copied out of a
// row without a drag across rows sweeping text along.
export function copyableText(text, { className } = {}) {
  const span = document.createElement("span");
  span.className = className
    ? `data-table-copyable ${className}`
    : "data-table-copyable";
  span.textContent = text;
  return span;
}

export class DataTable extends HTMLElement {
  static tableRow = tableRow;
  static tableCell = tableCell;
  static editableCell = editableCell;
  static selectCell = selectCell;
  static rowAction = rowAction;
  static actionsCell = actionsCell;
  static copyableText = copyableText;
  static additionalText = additionalText;
  static statusSwatch = statusSwatch;

  constructor() {
    super();
    this._columns = [];
    this._sortColumn = null;
    this._sortDirection = "asc";
    this._built = false;
    this._items = null;
    this._windowStart = 0;
    this._windowSize = Infinity;
    this._windowStep = 25;
    this._windowEdge = 200;
    this._selectedIds = new Set();
    this._anchorId = null;
    this._minHeight = 120;
    this.copyableSelector = ".data-table-copyable";
    this.onSort = null;
    this.onSelectAllChange = null;
    this.onRowClick = null;
    // Built-in selection (`selectable`): called with the new Set of row IDs.
    this.onSelectionChange = null;
    // Column menu: called with (key, visible). Without it the table shows and
    // hides the column itself.
    this.onColumnToggle = null;
    // Called after every row render, window or full.
    this.onRowsRender = null;
  }

  connectedCallback() {
    addDataTableStyles(this);
  }

  // Column descriptor shape: { label, key, sortKey, sortable, selectAll,
  // hideable, visible, align, headerClassName, size, width, minWidth,
  // fitText, fitField }. `size` is "hug", "draggable" or "stretch" (see
  // _applyColumnWidths); `width` is where a draggable column starts and
  // `minWidth` how narrow it may go if more than its head. A `fitText` column
  // hugs that text in the rows' type instead of its cells -- "0000" for a
  // number column, or a list for fields side by side. `fitField` measures it
  // inside an editable cell's box, "select" inside a dropdown field's.
  // `sortKey` is opaque to this component -- it is whatever the caller passed
  // back through `onSort`.
  // `key` names a hideable column in the column menu and `setColumnVisible`.
  set columns(columns) {
    this._columns = ownColumns(columns);
    this._build();
  }

  get columns() {
    return this._columns;
  }

  // Called with (rowId, event) for a click on a row's plain cells. When set,
  // the caller owns selection and `selectable` has no effect on clicks.
  set onRowClick(callback) {
    this._onRowClick = callback;
    this._table?.classList.toggle("data-table-clickable", this._isClickable());
  }

  get onRowClick() {
    return this._onRowClick;
  }

  get tbody() {
    return this._tbody;
  }

  get table() {
    return this._table;
  }

  // Class name applied to the built <table> element, so a caller's existing
  // CSS (keyed to that class name) keeps matching unchanged.
  set tableClassName(name) {
    this._tableClassName = name;
    if (this._table) {
      this._table.className = this._tableClasses();
    }
  }

  // Id applied to the built <tbody>, so a caller's existing
  // `document.querySelector("#...")` lookups keep working unchanged.
  set tbodyId(id) {
    this._tbodyId = id;
    if (this._tbody) {
      this._tbody.id = id;
    }
  }

  set sortableClassName(name) {
    this._sortableClassName = name;
  }

  set sortActiveClassName(name) {
    this._sortActiveClassName = name;
  }

  set sortLabelClassName(name) {
    this._sortLabelClassName = name;
  }

  set selectAllClassName(name) {
    this._selectAllClassName = name;
  }

  set selectAllTitle(title) {
    this._selectAllTitle = title;
    if (this._selectAllCheckbox) {
      this._selectAllCheckbox.title = title;
    }
  }

  // An extra class drawn on selected rows, beside data-table-row-selected.
  set selectedRowClassName(name) {
    this._selectedRowClassName = name;
    this._applySelectedRows();
  }

  // The table owns selection: click, Ctrl-click, Shift-click and the
  // select-all tick change it, and `onSelectionChange` reports it.
  set selectable(value) {
    this._selectable = !!value;
    this._table?.classList.toggle("data-table-clickable", this._isClickable());
  }

  // The rows sit in a scroll box of `--data-table-height`.
  set scrollable(value) {
    this.classList.toggle("data-table-scrollable", !!value);
    this._updateScrollReserve();
  }

  // A look table without a height of its own keeps a 16px strip under its
  // rows for its sideways bar, scrolling or not, so the bar never covers a
  // row.
  _updateScrollReserve() {
    this._scrollbars?.setReserve(
      this.hasAttribute("look") && !this.classList.contains("data-table-scrollable")
        ? 16
        : 0
    );
  }

  // A grip under the scroll box sets its height by drag. The height is kept
  // under `heightStorageKey` when one is set.
  set resizable(value) {
    this._resizable = !!value;
    this.classList.toggle("data-table-resizable", this._resizable);
    if (value) {
      this.scrollable = true;
    }
    if (this._grip) {
      this._grip.hidden = !value;
    }
  }

  // The design's look (table, Figma 2004:29827): "select" rules every row,
  // "data" only the selected ones. Unset keeps the plain table. Row icons
  // from `rowAction` draw as button/table icon in either look.
  set look(value) {
    this._look = value === "data" || value === "select" ? value : null;
    if (this._look) {
      this.setAttribute("look", this._look);
    } else {
      this.removeAttribute("look");
    }
    this._updateScrollReserve();
    this._applyLookToActions();
  }

  get look() {
    return this._look ?? null;
  }

  // Dragged widths are kept under this key, so they survive a reload. Unset,
  // they last for the page.
  set columnWidthsStorageKey(key) {
    this._columnWidthsStorageKey = key;
    let stored = null;
    try {
      stored = key ? localStorage.getItem(key) : null;
    } catch {
      stored = null;
    }
    this._columnWidths = parseStoredColumnWidths(stored);
    this._applyColumnWidths();
  }

  _columnId(column, index) {
    return column.key || column.label || column.sortKey || String(index);
  }

  _visibleColumns() {
    return this._columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => column.visible !== false && column._headerElement);
  }

  // Every column has one of three sizes (its `size`):
  // - "hug": as wide as its head or its widest cell, whichever is wider;
  // - "draggable": dragged by its head's right edge to any width, never
  //   narrower than its head; it starts at `width`, else hugging. The panel's
  //   width never changes it: a table too wide for its box scrolls sideways;
  // - "stretch": takes the room the others leave, never narrower than its
  //   head, or than its buttons if it holds any.
  // A column without a size hugs. Without a stretching column the table is
  // as wide as its columns, not its box. A table none of whose columns has a
  // size is laid out by the browser.
  _applyColumnWidths() {
    if (!this._table) {
      return;
    }
    const visible = this._visibleColumns();
    const sized = visible.some(({ column }) => column.size);
    const flex = sized ? this._flexEntry(visible) : null;
    let used = 0;
    for (const entry of visible) {
      const th = entry.column._headerElement;
      const draggable = sized && entry !== flex && entry.column.size === "draggable";
      const grip = th.querySelector(":scope > .data-table-column-grip");
      if (draggable && !grip) {
        th.appendChild(this._makeColumnGrip(entry.column, entry.index));
      } else if (!draggable && grip) {
        grip.remove();
      }
      // A head cell whose right edge has a grip draws that boundary as
      // draggable.
      th.classList.toggle("data-table-drag-right", draggable);
      if (!sized || entry === flex) {
        continue;
      }
      const width = this._columnWidth(entry);
      th.style.width = `${width}px`;
      used += width;
    }
    const box = this._scroll?.clientWidth || 0;
    if (flex) {
      const width = Math.max(this._stretchFloor(flex), box - used);
      flex.column._headerElement.style.width = `${width}px`;
      used += width;
    }
    // The columns are their widths, not their contents' (a fixed layout).
    this._table.style.tableLayout = sized ? "fixed" : "";
    this._table.style.minWidth = sized && used > box ? `${used}px` : "";
    this._table.style.width = sized && !flex ? `${used}px` : "";
  }

  _flexEntry(visible) {
    return visible.find(({ column }) => column.size === "stretch") ?? null;
  }

  // The narrowest the stretching column goes: its buttons, if its cells hold
  // any, else its head.
  _stretchFloor(entry) {
    const { column, index } = entry;
    const buttons = [...(this._tbody?.children || [])].some((row) =>
      row.children[index]?.querySelector("icon-button, button")
    );
    return buttons ? this._contentWidth(entry) : this._headWidth(column);
  }

  // A hugging or draggable column's width.
  _columnWidth(entry) {
    const { column, index } = entry;
    if (column.size !== "draggable") {
      return this._contentWidth(entry);
    }
    const width =
      this._columnWidths?.[this._columnId(column, index)] ??
      column.width ??
      this._contentWidth(entry);
    return Math.max(this._dragFloor(column), width);
  }

  // The narrowest a draggable column goes: its head, or `minWidth` if wider.
  _dragFloor(column) {
    return Math.max(column.minWidth ?? 0, this._headWidth(column));
  }

  // A column's contents' width: its head or its widest cell, whichever is
  // wider. A `fitText` column measures that text instead of its cells.
  _contentWidth({ column, index }) {
    if (column.fitText != null) {
      return this._fitTextWidth(column);
    }
    const cells = [column._headerElement];
    for (const row of this._tbody?.children || []) {
      const cell = row.children[index];
      if (cell) {
        cells.push(cell);
      }
    }
    return huggedColumnWidth(
      cells.map((cell) => html.naturalCellWidth(cell)),
      0,
      Infinity
    );
  }

  // Texts set in `cell` side by side, FIT_FIELD_GAP apart, with the cell's
  // padding and `boxPadding` round each.
  _measureTexts(cell, texts, className, boxPadding = 0) {
    const style = getComputedStyle(cell);
    let width =
      parseFloat(style.paddingLeft) +
      parseFloat(style.paddingRight) +
      FIT_FIELD_GAP * (texts.length - 1) +
      boxPadding * texts.length;
    for (const text of texts) {
      const probe = document.createElement("span");
      probe.className = className || "";
      probe.style.cssText =
        "display: inline-block; width: auto; position: absolute; visibility: hidden;";
      probe.textContent = text;
      cell.appendChild(probe);
      width += probe.getBoundingClientRect().width;
      probe.remove();
    }
    return width;
  }

  _headWidth(column) {
    return Math.ceil(this._measureTexts(column._headerElement, [column.label || ""]));
  }

  // A `fitText` column's width: its text set in a row's cell, or its label
  // in its head, whichever is wider. A list is several fields side by side.
  // `fitField` measures it inside an editable cell's box, "select" inside a
  // dropdown field's. Measured while shown, so it follows the look's type.
  _fitTextWidth(column) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    row.appendChild(cell);
    this._tbody.appendChild(row);
    const text = this._measureTexts(
      cell,
      [].concat(column.fitText).map(String),
      column.fitField === "select"
        ? "data-table-select"
        : column.fitField
          ? "data-table-input"
          : "",
      // The smol box round the text (smol.js): 3px and a 1px edge each side,
      // a dropdown's arrow side 10px and the edge.
      column.fitField === "select" ? 15 : column.fitField ? 8 : 0
    );
    row.remove();
    return Math.ceil(Math.max(this._headWidth(column), text));
  }

  _storeColumnWidths() {
    if (!this._columnWidthsStorageKey) {
      return;
    }
    try {
      localStorage.setItem(
        this._columnWidthsStorageKey,
        JSON.stringify(this._columnWidths)
      );
    } catch {
      // The widths still apply for this page.
    }
  }

  _makeColumnGrip(column, index) {
    const grip = html.div({ class: "data-table-column-grip" });
    const id = this._columnId(column, index);
    // A click on the grip is not a click on the head (no sort).
    grip.addEventListener("click", (event) => event.stopPropagation());
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const startWidth = this._columnWidth({ column, index });
      const startX = event.clientX;
      const floor = this._dragFloor(column);
      grip.setPointerCapture(event.pointerId);
      grip.classList.add("dragging");
      document.documentElement.classList.add("data-table-column-resizing");
      const onMove = (moveEvent) => {
        this._columnWidths = {
          ...this._columnWidths,
          [id]: resizedColumnWidth(startWidth, moveEvent.clientX - startX, floor),
        };
        this._applyColumnWidths();
      };
      const onEnd = () => {
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onEnd);
        grip.removeEventListener("lostpointercapture", onEnd);
        grip.classList.remove("dragging");
        document.documentElement.classList.remove("data-table-column-resizing");
        this._showHeadDividers?.();
        this._storeColumnWidths();
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onEnd);
      grip.addEventListener("lostpointercapture", onEnd);
    });
    // A double-click hugs the column to its contents: its head and the rows
    // drawn now.
    grip.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this._columnWidths = {
        ...this._columnWidths,
        [id]: Math.max(this._dragFloor(column), this._contentWidth({ column, index })),
      };
      this._applyColumnWidths();
      this._storeColumnWidths();
    });
    return grip;
  }

  set heightStorageKey(key) {
    this._heightStorageKey = key;
    let stored;
    try {
      stored = key ? parseInt(localStorage.getItem(key)) : NaN;
    } catch {
      stored = NaN;
    }
    if (Number.isFinite(stored)) {
      this._applyHeight(Math.max(this._minHeight, stored));
    }
  }

  set minHeight(height) {
    this._minHeight = height;
  }

  // Rows rendered at once. Unset renders every item.
  set windowSize(size) {
    this._windowSize = size > 0 ? size : Infinity;
  }

  set windowStep(step) {
    this._windowStep = step;
  }

  set windowEdge(edge) {
    this._windowEdge = edge;
  }

  get scrollElement() {
    return this._scroll;
  }

  get windowStart() {
    return this._windowStart;
  }

  setSortState(column, direction) {
    this._sortColumn = column;
    this._sortDirection = direction;
    this._updateSortHeaders();
  }

  setSelectAllState({ checked, indeterminate }) {
    if (!this._selectAllCheckbox) {
      return;
    }
    this._selectAllCheckbox.checked = !!checked;
    this._selectAllCheckbox.indeterminate = !!indeterminate;
  }

  setColumnVisible(key, visible) {
    const column = this._columns.find((candidate) => candidate.key === key);
    if (!column) {
      return;
    }
    column.visible = !!visible;
    this._applyColumnVisibility();
    this._applyColumnWidths();
    this._storeHiddenColumns();
  }

  // Where the hideable columns turned off are kept: set after `columns`, it
  // turns them off again, and every toggle from then on is stored.
  set hiddenColumnsStorageKey(key) {
    this._hiddenColumnsStorageKey = key;
    let hidden = [];
    try {
      hidden = JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      hidden = [];
    }
    for (const column of this._columns) {
      if (column.hideable && column.key) {
        column.visible = !hidden.includes(column.key);
      }
    }
    this._applyColumnVisibility();
    this._applyColumnWidths();
  }

  _storeHiddenColumns() {
    if (!this._hiddenColumnsStorageKey) {
      return;
    }
    const hidden = this._columns
      .filter((column) => column.hideable && column.key && column.visible === false)
      .map((column) => column.key);
    try {
      localStorage.setItem(this._hiddenColumnsStorageKey, JSON.stringify(hidden));
    } catch {
      // The columns still show as toggled for this page.
    }
  }

  isColumnVisible(key) {
    return this._columns.find((column) => column.key === key)?.visible !== false;
  }

  // Render `items` through `renderRow(item, index)`, which returns a <tr>.
  // `rowId(item)` gives each item's row ID, for Shift-click ranges and
  // select-all over rows outside the window. `resetWindow` moves the window
  // to the top, for a new query rather than a refresh of the same one.
  setRows(items, renderRow, { rowId, resetWindow = false } = {}) {
    this._items = items || [];
    this._renderRow = renderRow;
    this._rowIdOf = rowId;
    if (resetWindow) {
      this._windowStart = 0;
    }
    this._windowStart = clampWindowStart(
      this._windowStart,
      this._items.length,
      this._windowSize
    );
    this._renderWindow();
  }

  // Row IDs of every item given to `setRows`, in and out of the window.
  itemRowIds() {
    if (!this._items || !this._rowIdOf) {
      return this.loadedRowIds();
    }
    return this._items.map((item) => this._rowIdOf(item));
  }

  // Row IDs of the rows in the document, in order.
  loadedRowIds() {
    if (!this._tbody) {
      return [];
    }
    return [...this._tbody.querySelectorAll("tr[data-row-id]")].map(
      (tr) => tr.dataset.rowId
    );
  }

  get selectedRowIds() {
    return new Set(this._selectedIds);
  }

  // Draws `ids` as the selected rows. With `selectable` the table also keeps
  // them as its selection.
  setSelectedRows(ids) {
    this._selectedIds = new Set(ids);
    this._applySelectedRows();
  }

  // Slides the window by `delta` rows and keeps the row at the box's top edge
  // where it was.
  shiftWindow(delta) {
    const total = this._items?.length || 0;
    const newStart = clampWindowStart(
      this._windowStart + delta,
      total,
      this._windowSize
    );
    if (newStart === this._windowStart) {
      return;
    }
    const scroller = this._scroll;
    let anchorId, anchorOffset;
    const containerTop = scroller.getBoundingClientRect().top;
    for (const tr of this._tbody.querySelectorAll("tr[data-row-id]")) {
      const rect = tr.getBoundingClientRect();
      if (rect.bottom > containerTop) {
        anchorId = tr.dataset.rowId;
        anchorOffset = rect.top - containerTop;
        break;
      }
    }
    this._windowStart = newStart;
    this._renderWindow();
    if (anchorId == null) {
      return;
    }
    const newRow = [...this._tbody.querySelectorAll("tr[data-row-id]")].find(
      (tr) => tr.dataset.rowId === anchorId
    );
    if (newRow) {
      const newOffset = newRow.getBoundingClientRect().top - containerTop;
      scroller.scrollTop += newOffset - anchorOffset;
    }
  }

  _tableClasses() {
    return ["data-table", this._tableClassName || ""].join(" ").trim();
  }

  _isClickable() {
    return !!(this._selectable || this.onRowClick);
  }

  _build() {
    if (this._built) {
      // Columns are supplied once, at setup time -- there is no caller that
      // changes them after the fact.
      return;
    }
    this._built = true;

    const headRow = html.createDomElement("tr");
    for (const column of this._columns) {
      const th = html.createDomElement("th", {
        class: column.headerClassName || "",
      });
      if (column.align === "right") {
        th.classList.add("data-table-align-right");
      }
      if (column.sortable) {
        th.classList.add("data-table-sortable");
        if (this._sortableClassName) {
          th.classList.add(this._sortableClassName);
        }
        th.dataset.sortColumn = column.sortKey;
        th.dataset.sortLabel = column.label;
        th.addEventListener("click", () => this.onSort?.(column.sortKey));
      }
      if (column.selectAll) {
        const checkbox = html.createDomElement("input", {
          type: "checkbox",
          class: this._selectAllClassName || "",
          title: this._selectAllTitle || "",
        });
        checkbox.addEventListener("change", () => {
          checkbox.indeterminate = false;
          this._selectAllChanged(checkbox.checked);
        });
        this._selectAllCheckbox = checkbox;
        th.appendChild(checkbox);
      }
      const label = html.createDomElement("span", {
        class: this._sortLabelClassName || "",
      });
      label.textContent = column.label;
      th.appendChild(label);
      column._labelElement = label;
      column._headerElement = th;
      headRow.appendChild(th);
    }
    const thead = html.createDomElement("thead", {}, [headRow]);
    thead.addEventListener("contextmenu", (event) => this._showColumnMenu(event));
    this._showHeadDividers = html.trackHeadDividers(thead, {
      cells: () => this._visibleColumns().map(({ column }) => column._headerElement),
      handleSelector: ".data-table-column-grip",
      shownClass: "data-table-divider-shown",
    });

    const tbody = html.createDomElement("tbody", { id: this._tbodyId || "" });
    tbody.addEventListener("click", (event) => {
      if (
        event.target.closest(
          "input, select, textarea, button, icon-button, ui-checkmark, a, " +
            ".data-table-action"
        )
      ) {
        return;
      }
      const tr = event.target.closest("tr[data-row-id]");
      if (!tr) {
        return;
      }
      if (this.onRowClick) {
        this.onRowClick(tr.dataset.rowId, event);
      } else if (this._selectable) {
        this._selectFromClick(tr.dataset.rowId, event);
      }
    });
    tbody.addEventListener("dblclick", (event) => {
      const name = event.target?.closest?.(this.copyableSelector);
      if (!name) {
        return;
      }
      name.setAttribute("data-selectable-name", "");
      const range = document.createRange();
      range.selectNodeContents(name);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });

    // Rows a caller appends itself get the table icons too.
    new MutationObserver(() => this._applyLookToActions()).observe(tbody, {
      childList: true,
      subtree: true,
    });

    const table = html.createDomElement("table", { class: this._tableClasses() }, [
      thead,
      tbody,
    ]);
    this._table = table;
    this._tbody = tbody;
    table.classList.toggle("data-table-clickable", this._isClickable());

    // Focusable by a click, so the table knows it has the focus: its
    // selection is lime then, grey otherwise.
    this._scroll = html.div({ class: "data-table-scroll", tabindex: "-1" }, [table]);
    // The design's scrollbars, drawn (scrollbars.js).
    this._scrollbars = attachScrollbars(this._scroll);
    this._updateScrollReserve();
    this._scroll.addEventListener("scroll", () => this._scrolled());
    const handle = html.createDomElement("ui-handle");
    handle.addEventListener("handle-drag-start", () => this._startResize());
    handle.addEventListener("handle-drag", (event) => this._resizeTo(event.detail.dy));
    handle.addEventListener("handle-drag-end", () => this._endResize());
    this._grip = html.div({ class: "data-table-grip" }, [handle]);
    this._grip.hidden = !this._resizable;
    this.append(this._scroll, this._grip);

    this._applyColumnVisibility();
    this._updateSortHeaders();
    this._applyColumnWidths();
    // The stretching column follows the box.
    new ResizeObserver(() => this._boxResized()).observe(this._scroll);
  }

  _boxResized() {
    this._applyColumnWidths();
  }

  _renderWindow() {
    if (!this._tbody || !this._items) {
      return;
    }
    const focus = this._saveCellFocus();
    this._tbody.textContent = "";
    const end = windowEnd(this._windowStart, this._items.length, this._windowSize);
    for (let index = this._windowStart; index < end; index++) {
      this._tbody.appendChild(this._renderRow(this._items[index], index));
    }
    this._applySelectedRows();
    this._applyLookToActions();
    if (this._selectable) {
      this._syncSelectAll();
    }
    // A hugging column follows the rows now drawn.
    this._applyColumnWidths();
    this._restoreCellFocus(focus);
    this.onRowsRender?.();
  }

  // A redraw replaces every row, so a field being edited -- stepped with the
  // arrow keys, say, where each step writes and the write redraws -- would
  // lose the focus. The row's id and the field's place in the row find it
  // again in the new rows.
  _saveCellFocus() {
    const active = this.getRootNode().activeElement;
    if (!active || !this._tbody.contains(active)) {
      return null;
    }
    const tr = active.closest("tr[data-row-id]");
    if (!tr) {
      return null;
    }
    const fields = [...tr.querySelectorAll("input, select, textarea, ui-checkmark")];
    let selectionStart = null;
    let selectionEnd = null;
    try {
      selectionStart = active.selectionStart ?? null;
      selectionEnd = active.selectionEnd ?? null;
    } catch {
      // Some field types have no text selection.
    }
    return {
      rowId: tr.dataset.rowId,
      index: fields.indexOf(active),
      selectionStart,
      selectionEnd,
    };
  }

  _restoreCellFocus(focus) {
    if (!focus || focus.index < 0) {
      return;
    }
    const tr = [...this._tbody.querySelectorAll("tr[data-row-id]")].find(
      (row) => row.dataset.rowId === focus.rowId
    );
    const field = tr?.querySelectorAll("input, select, textarea, ui-checkmark")[focus.index];
    if (!field) {
      return;
    }
    field.focus({ preventScroll: true });
    try {
      if (focus.selectionStart != null) {
        field.setSelectionRange(focus.selectionStart, focus.selectionEnd);
      }
    } catch {
      // A number field has no text selection to put back.
    }
  }

  _scrolled() {
    if (!this._items?.length || this._windowSize === Infinity) {
      return;
    }
    const delta = scrollWindowShift({
      scrollTop: this._scroll.scrollTop,
      scrollHeight: this._scroll.scrollHeight,
      clientHeight: this._scroll.clientHeight,
      start: this._windowStart,
      total: this._items.length,
      size: this._windowSize,
      step: this._windowStep,
      edge: this._windowEdge,
    });
    if (delta) {
      this.shiftWindow(delta);
    }
  }

  _applyHeight(height) {
    this.style.setProperty("--data-table-height", `${height}px`);
  }

  // The handle captures the pointer and reports the drag; these follow it.
  _startResize() {
    this._resizeInitialHeight = this._scroll.getBoundingClientRect().height;
    this._resizeHeight = undefined;
    document.documentElement.classList.add("data-table-resizing");
  }

  _resizeTo(dy) {
    this._resizeHeight = Math.max(this._minHeight, this._resizeInitialHeight + dy);
    this._applyHeight(this._resizeHeight);
  }

  _endResize() {
    document.documentElement.classList.remove("data-table-resizing");
    if (this._resizeHeight !== undefined && this._heightStorageKey) {
      try {
        localStorage.setItem(this._heightStorageKey, this._resizeHeight);
      } catch {
        // The height still applies for this page.
      }
    }
  }

  _applyLookToActions() {
    if (!this._tbody) {
      return;
    }
    // Every icon in a row, the cells' own included, is a table icon.
    for (const button of this._tbody.querySelectorAll("icon-button")) {
      if (!!button.table !== !!this._look) {
        button.table = !!this._look;
      }
    }
  }

  _showColumnMenu(event) {
    const hideable = this._columns.filter((column) => column.hideable && column.key);
    // `extraMenuItems`: toggles that are not whole columns (a part of a
    // cell, say), as [{key, label, visible}]; they go to onColumnToggle too.
    const extra = this.extraMenuItems || [];
    if (!hideable.length && !extra.length) {
      return;
    }
    event.preventDefault();
    const toggle = (key, visible, isColumn) => {
      if (this.onColumnToggle) {
        this.onColumnToggle(key, visible);
      } else if (isColumn) {
        this.setColumnVisible(key, visible);
      }
    };
    showMenu(
      [
        ...hideable.map((column) => ({
          title: column.label,
          checked: column.visible !== false,
          callback: () => toggle(column.key, column.visible === false, true),
        })),
        ...extra.map((item) => ({
          title: item.label,
          checked: item.visible !== false,
          callback: () => toggle(item.key, item.visible === false, false),
        })),
      ],
      event
    );
  }

  _applyColumnVisibility() {
    if (!this._table) {
      return;
    }
    this._columns.forEach((column, index) => {
      if (index < MAX_HIDEABLE_COLUMNS) {
        this._table.classList.toggle(
          `data-table-hide-${index + 1}`,
          column.visible === false
        );
      }
    });
  }

  _selectFromClick(id, event) {
    if (event.shiftKey && this._anchorId != null) {
      this._selectedIds = selectRange(
        { selected: this._selectedIds },
        this._anchorId,
        id,
        this.itemRowIds()
      ).selected;
    } else {
      this._selectedIds = selectRow(
        { selected: this._selectedIds },
        id,
        event.ctrlKey || event.metaKey
      ).selected;
      this._anchorId = id;
    }
    this._selectionChanged();
  }

  _selectAllChanged(checked) {
    if (this.onSelectAllChange) {
      this.onSelectAllChange(checked);
      return;
    }
    if (this._selectable) {
      this._selectedIds = checked ? new Set(this.itemRowIds()) : new Set();
      this._selectionChanged();
    }
  }

  _selectionChanged() {
    this._applySelectedRows();
    this._syncSelectAll();
    this.onSelectionChange?.(new Set(this._selectedIds));
  }

  _syncSelectAll() {
    const ids = this.itemRowIds();
    const count = ids.filter((id) => this._selectedIds.has(id)).length;
    this.setSelectAllState({
      checked: ids.length > 0 && count === ids.length,
      indeterminate: count > 0 && count < ids.length,
    });
  }

  _applySelectedRows() {
    if (!this._tbody) {
      return;
    }
    for (const tr of this._tbody.querySelectorAll("tr[data-row-id]")) {
      const selected = this._selectedIds.has(tr.dataset.rowId);
      tr.classList.toggle("data-table-row-selected", selected);
      if (this._selectedRowClassName) {
        tr.classList.toggle(this._selectedRowClassName, selected);
      }
    }
  }

  _updateSortHeaders() {
    for (const column of this._columns) {
      if (!column.sortable || !column._headerElement) {
        continue;
      }
      const isActive = column.sortKey === this._sortColumn;
      column._headerElement.classList.toggle("data-table-sort-active", isActive);
      if (this._sortActiveClassName) {
        column._headerElement.classList.toggle(this._sortActiveClassName, isActive);
      }
      const arrow = isActive ? (this._sortDirection === "desc" ? " ▼" : " ▲") : "";
      column._labelElement.textContent = column.label + arrow;
    }
  }
}

customElements.define("data-table", DataTable);
