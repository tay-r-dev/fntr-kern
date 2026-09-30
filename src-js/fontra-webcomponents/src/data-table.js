import * as html from "@fontra/core/html-utils.js";
import {
  clampWindowStart,
  fitColumnWidths,
  parseCellValue,
  spreadColumnWidths,
  parseStoredColumnWidths,
  resizedColumnWidth,
  scrollWindowShift,
  stepCellValue,
  windowEnd,
} from "./data-table-model.js";
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

// The looks' colors (`look` = "data" or "select").
const lookColors = {
  "data-table-look-background-color": ["#fff", "#2c2c2c"],
  "data-table-look-border-color": ["#e9e9e9", "#3a3a3a"],
  "data-table-look-rule-color": ["rgba(21, 21, 21, 0.1)", "rgba(255, 255, 255, 0.1)"],
  "data-table-look-heading-color": ["#b4b4b4", "#8e8e8e"],
  "data-table-look-entry-color": ["#565656", "#c0c0c0"],
  "data-table-look-entry-hover-color": ["#303030", "#e0e0e0"],
  "data-table-look-additional-color": ["#b4b4b4", "#8e8e8e"],
  "data-table-look-additional-hover-color": ["#8e8e8e", "#b4b4b4"],
  "data-table-look-active-color": ["#f7f7f7", "#3a3a3a"],
  "data-table-look-focus-border-color": ["#def280", "#8fae4a"],
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

  /* The look is not weak: it has to beat a page's global input rule. */
  .data-table .data-table-input,
  .data-table .data-table-select {
    box-sizing: border-box;
    min-width: 0;
    margin: 0;
    padding: 0 0.15em;
    border: 1px solid transparent;
    border-radius: 0.15em;
    background: transparent;
    color: inherit;
    font: inherit;
    appearance: none;
    -webkit-appearance: none;
  }

  .data-table .data-table-input[type="number"] {
    text-align: right;
    -moz-appearance: textfield;
  }

  .data-table-input::-webkit-outer-spin-button,
  .data-table-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .data-table .data-table-select:not(:disabled) {
    cursor: pointer;
  }

  .data-table tr:hover .data-table-input:not(:disabled),
  .data-table tr:hover .data-table-select:not(:disabled) {
    border-color: var(--horizontal-rule-color, #ccc);
  }

  .data-table .data-table-input:focus,
  .data-table .data-table-select:focus {
    border-color: var(--foreground-color);
    outline: none;
  }

  :where(.data-table-action) {
    width: 1.1em;
    height: 1.1em;
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
    gap: 0.3em;
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

  /* The head stays put while the rows scroll under it. */
  :where(data-table.data-table-scrollable thead th) {
    position: sticky;
    top: 0;
    z-index: 1;
    background-color: var(--background-color, #fff);
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
    padding-bottom: calc(0.15em + 14px);
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

  /* The looks (table/data, Figma 417:8097; table/select, Figma 417:8683):
     a white box, ruled and rounded; a 24px head of small uppercase light
     grey labels over a rule; 26px rows of thin grey entries, the light grey
     fill on a selected (active) row. table/data rules every row and shows a
     row's editable box and icons on hover; table/select rules only the head
     and darkens a hovered row's text instead. */
  data-table[look] > .data-table-scroll {
    box-sizing: border-box;
    border: 1px solid var(--data-table-look-border-color);
    border-radius: 6px;
    background-color: var(--data-table-look-background-color);
    /* A column dragged wider than the box scrolls sideways. */
    overflow-x: auto;
  }

  data-table[look]:not(.data-table-scrollable) > .data-table-scroll {
    overflow: hidden;
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

  /* A collapsed border does not travel with a sticky head, so the head's
     rule is drawn inside it instead. */
  data-table[look] .data-table th {
    background-color: var(--data-table-look-background-color);
    border-bottom: none;
    box-shadow: inset 0 -1px var(--data-table-look-rule-color);
  }

  /* ui/table/heading */
  data-table[look] .data-table th {
    height: 24px;
    box-sizing: border-box;
    font: 400 semi-condensed 8px / 10px var(--ui-font-mono);
    letter-spacing: var(--ui-tracking);
    text-transform: uppercase;
    color: var(--data-table-look-heading-color);
  }

  /* The sort is told by its arrow; the head keeps one colour. */
  data-table[look] .data-table th.data-table-sort-active {
    font-weight: 400;
  }

  /* ui/table/entry */
  data-table[look] .data-table td {
    height: 26px;
    box-sizing: border-box;
    font-family: var(--ui-font-mono);
    font-size: 9px;
    font-weight: 220;
    font-stretch: 80%;
    line-height: 10px;
    letter-spacing: var(--ui-tracking);
    font-feature-settings: "case" 1;
    color: var(--data-table-look-entry-color);
  }

  data-table[look] .data-table tbody tr:last-child td {
    border-bottom: none;
  }

  data-table[look].data-table-resizable .data-table tbody tr:last-child td {
    height: 40px;
    padding-bottom: 12px;
  }

  data-table[look] .data-table .data-table-row-selected {
    background-color: var(--data-table-look-active-color);
  }

  data-table[look] .data-table-additional {
    margin-left: 4px;
    color: var(--data-table-look-additional-color);
  }

  data-table[look="select"] .data-table td {
    border-bottom: none;
  }

  data-table[look="select"] .data-table tbody tr:hover td {
    color: var(--data-table-look-entry-hover-color);
  }

  data-table[look="select"] .data-table tbody tr:hover .data-table-additional {
    color: var(--data-table-look-additional-hover-color);
  }

  /* The row's icons: button/table icon, 18px, 4px apart; hidden at rest and
     shown whole on the row's hover. */
  /* Every icon in a row is the glyph sources' size: a 12px glyph in an
     18px slot, whether it is a button or a plain icon. */
  data-table[look] tbody icon-button {
    width: 18px;
    height: 18px;
    vertical-align: middle;
    --icon-button-icon-size: 12px;
  }

  data-table[look] tbody td > inline-svg,
  data-table[look] tbody td > span > inline-svg {
    box-sizing: content-box;
    width: 12px;
    height: 12px;
    padding: 3px;
    vertical-align: middle;
  }

  data-table[look] .data-table-actions {
    gap: 4px;
  }

  data-table[look] tbody icon-button + icon-button {
    margin-left: 4px;
  }

  data-table[look] .data-table-actions icon-button + icon-button {
    margin-left: 0;
  }

  data-table[look] tr:hover .data-table-reveal-hover,
  data-table[look] tr:focus-within .data-table-reveal-hover,
  data-table[look] tr:hover .data-table-reveal-dim,
  data-table[look] tr:focus-within .data-table-reveal-dim {
    opacity: 1;
  }

  /* The editable entry (table/data "editable"): an 18px box, 6px in and
     12px out, drawn on the row's hover, white on a selected row, lime-edged
     while typing. */
  data-table[look] .data-table .data-table-input,
  data-table[look] .data-table .data-table-select {
    height: 18px;
    padding: 3px 12px 3px 6px;
    border: 1px solid transparent;
    border-radius: 3px;
  }

  data-table[look] .data-table tr:hover .data-table-input:not(:disabled),
  data-table[look] .data-table tr:hover .data-table-select:not(:disabled) {
    border-color: transparent;
    background-color: var(--data-table-look-active-color);
  }

  data-table[look] .data-table .data-table-row-selected .data-table-input:not(:disabled),
  data-table[look] .data-table .data-table-row-selected .data-table-select:not(:disabled) {
    background-color: var(--data-table-look-background-color);
  }

  data-table[look] .data-table .data-table-input:focus,
  data-table[look] .data-table .data-table-select:focus {
    border-color: var(--data-table-look-focus-border-color);
    background-color: var(--data-table-look-background-color);
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
// design's orange, or a CSS color.
export function tableRow(rowId, cells, { className, title, marker } = {}) {
  const tr = document.createElement("tr");
  if (rowId != null) {
    tr.dataset.rowId = rowId;
  }
  if (className) {
    tr.className = className;
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
  const input = document.createElement("input");
  input.type = type;
  input.className = className ? `data-table-input ${className}` : "data-table-input";
  if (step != null) {
    input.step = String(step);
  }
  if (title) {
    input.title = title;
  }
  if (placeholder) {
    input.placeholder = placeholder;
  }
  input.disabled = disabled;
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
  const select = document.createElement("select");
  select.className = className ? `data-table-select ${className}` : "data-table-select";
  select.disabled = disabled;
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label ?? option.value;
    element.selected = option.value === value;
    select.appendChild(element);
  }
  select.addEventListener("change", () => onChange?.(select.value));
  return select;
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

// A status cell's swatch (table/select "status"): an 18px rounded box of
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
  // hideable, visible, align, headerClassName }. `sortKey` is opaque to this
  // component -- it is whatever the caller passed back through `onSort`.
  // `key` names a hideable column in the column menu and `setColumnVisible`.
  set columns(columns) {
    this._columns = columns || [];
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

  // The design's look: "data" (table/data, every row ruled) or "select"
  // (table/select, only the head ruled). Unset keeps the plain table. Row
  // icons from `rowAction` draw as button/table icon in either look.
  set look(value) {
    this._look = value === "data" || value === "select" ? value : null;
    if (this._look) {
      this.setAttribute("look", this._look);
    } else {
      this.removeAttribute("look");
    }
    this._applyLookToActions();
  }

  get look() {
    return this._look ?? null;
  }

  // Columns can be resized by dragging a head cell's right edge, and the
  // widths are kept under this key, so they survive a reload. Unset, the
  // columns cannot be dragged.
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

  // Every column but the last has a width: the one it was dragged to, else
  // its descriptor's `width`. The last stretches to take what is left, never
  // less than its `minWidth` (48px by default). A table whose columns have no
  // widths at all shares its width among them as before.
  _applyColumnWidths() {
    if (!this._table || !this._columnWidthsStorageKey) {
      return;
    }
    const visible = this._visibleColumns();
    const last = visible[visible.length - 1];
    const fixed = visible.filter(({ column }) => column !== last?.column);
    const widthOf = ({ column, index }) =>
      this._columnWidths?.[this._columnId(column, index)] ?? column.width ?? null;
    const anyWidth = fixed.some((entry) => widthOf(entry) != null);

    if (last) {
      // The flexing column has no handle.
      last.column._headerElement
        .querySelector(":scope > .data-table-column-grip")
        ?.remove();
    }
    const box = this._scroll?.clientWidth || 0;
    const lastMin = last?.column.minWidth ?? 48;
    const widths = fixed.map((entry) => (anyWidth ? (widthOf(entry) ?? 80) : null));
    // Every column but the last keeps its own width; only the last stretches,
    // to fill the box, never below its minimum. When the box is too narrow
    // for them and that minimum, every fixed column gives up the same amount
    // (fitColumnWidths) -- on screen only; the kept widths come back when the
    // box widens.
    const shown =
      anyWidth && box > 0
        ? fitColumnWidths(
            widths,
            box - lastMin,
            fixed.map(({ column }) => column.minWidth ?? 24)
          )
        : widths;
    let used = 0;
    fixed.forEach((entry, i) => {
      const th = entry.column._headerElement;
      if (!th.querySelector(":scope > .data-table-column-grip")) {
        th.appendChild(this._makeColumnGrip(entry.column, entry.index));
      }
      const width = shown[i] || null;
      th.style.width = width ? `${width}px` : "";
      used += width || 0;
    });
    if (last) {
      last.column._headerElement.style.width =
        anyWidth && box > 0 ? `${Math.max(lastMin, box - used)}px` : "";
    }
    this._table.style.minWidth = "";
  }

  _maxColumnWidth(column) {
    const visible = this._visibleColumns();
    const last = visible[visible.length - 1];
    let others = 0;
    for (const entry of visible) {
      if (entry.column === column || entry.column === last?.column) {
        continue;
      }
      others +=
        this._columnWidths?.[this._columnId(entry.column, entry.index)] ??
        entry.column.width ??
        80;
    }
    const box = this._scroll?.clientWidth || 0;
    return box > 0 ? box - (last?.column.minWidth ?? 48) - others : Infinity;
  }

  _storeColumnWidths() {
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
    // A click on the grip is not a click on the head (no sort).
    grip.addEventListener("click", (event) => event.stopPropagation());
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const id = this._columnId(column, index);
      // A drag starts from what is on screen: the fixed columns' shown widths
      // (shrunk to fit a narrow box, maybe) become their kept ones.
      const visible = this._visibleColumns();
      const lastColumn = visible[visible.length - 1]?.column;
      this._columnWidths = { ...this._columnWidths };
      for (const entry of visible) {
        if (entry.column !== lastColumn) {
          this._columnWidths[this._columnId(entry.column, entry.index)] = Math.round(
            entry.column._headerElement.getBoundingClientRect().width
          );
        }
      }
      const startWidth = this._columnWidths[id];
      const startX = event.clientX;
      grip.setPointerCapture(event.pointerId);
      grip.classList.add("dragging");
      document.documentElement.classList.add("data-table-column-resizing");
      // The widest this column can go: the box, less the last column's
      // minimum and every other fixed column's width. The table never leaves
      // its box, so with the last column at its minimum a column can only
      // narrow.
      const maxWidth = this._maxColumnWidth(column);
      const onMove = (moveEvent) => {
        this._columnWidths[id] = Math.min(
          maxWidth,
          resizedColumnWidth(
            startWidth,
            moveEvent.clientX - startX,
            column.minWidth ?? 24
          )
        );
        this._applyColumnWidths();
      };
      const onEnd = () => {
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onEnd);
        grip.removeEventListener("lostpointercapture", onEnd);
        grip.classList.remove("dragging");
        document.documentElement.classList.remove("data-table-column-resizing");
        this._storeColumnWidths();
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onEnd);
      grip.addEventListener("lostpointercapture", onEnd);
    });
    // A double-click lets every column go back to sharing the table's width.
    grip.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this._columnWidths = {};
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

    const tbody = html.createDomElement("tbody", { id: this._tbodyId || "" });
    tbody.addEventListener("click", (event) => {
      if (
        event.target.closest(
          "input, select, textarea, button, icon-button, a, .data-table-action"
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

    this._scroll = html.div({ class: "data-table-scroll" }, [table]);
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
    // The box widening or narrowing is shared equally by the fixed columns,
    // and kept; the last column changes width only when a column is dragged.
    new ResizeObserver(() => this._boxResized()).observe(this._scroll);
  }

  _boxResized() {
    const box = this._scroll?.clientWidth || 0;
    const previous = this._lastBoxWidth;
    this._lastBoxWidth = box;
    if (this._columnWidthsStorageKey && previous > 0 && box > 0 && box !== previous) {
      const visible = this._visibleColumns();
      const fixed = visible.slice(0, -1);
      const ids = fixed.map(({ column, index }) => this._columnId(column, index));
      const current = fixed.map(
        ({ column }, i) => this._columnWidths?.[ids[i]] ?? column.width ?? null
      );
      if (current.every((width) => width != null)) {
        // Growing: every fixed column gains the same. Shrinking: the last
        // column gives up its room first, down to its minimum; only what is
        // still over comes off the fixed columns, equally.
        let delta = box - previous;
        if (delta > 0) {
          // The last column takes an equal share too: the fixed columns get
          // theirs, and the last fills what they leave, so it grows as much.
          delta = (delta * current.length) / (current.length + 1);
        } else if (delta < 0) {
          const sum = current.reduce((total, width) => total + width, 0);
          const lastMin = visible[visible.length - 1]?.column.minWidth ?? 48;
          const slack = Math.max(0, previous - sum - lastMin);
          delta = Math.min(0, delta + slack);
        }
        const next = spreadColumnWidths(
          current,
          delta,
          fixed.map(({ column }) => column.minWidth ?? 24)
        );
        this._columnWidths = { ...this._columnWidths };
        ids.forEach((id, i) => (this._columnWidths[id] = next[i]));
        this._storeColumnWidths();
      }
    }
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
    const fields = [...tr.querySelectorAll("input, select, textarea")];
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
    const field = tr?.querySelectorAll("input, select, textarea")[focus.index];
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
