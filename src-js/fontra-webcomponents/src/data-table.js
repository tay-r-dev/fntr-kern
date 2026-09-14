import * as html from "@fontra/core/html-utils.js";
import {
  clampWindowStart,
  parseCellValue,
  scrollWindowShift,
  windowEnd,
} from "./data-table-model.js";
import "./icon-button.js";
import { showMenu } from "./menu-panel.js";
import { selectRange, selectRow } from "./table-selection.js";

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

  :where(.data-table-input, .data-table-select) {
    box-sizing: border-box;
    width: 100%;
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

  :where(.data-table-input[type="number"]) {
    text-align: right;
    -moz-appearance: textfield;
  }

  .data-table-input::-webkit-outer-spin-button,
  .data-table-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  :where(.data-table-select:not(:disabled)) {
    cursor: pointer;
  }

  :where(.data-table tr:hover .data-table-input:not(:disabled),
    .data-table tr:hover .data-table-select:not(:disabled)) {
    border-color: var(--horizontal-rule-color, #ccc);
  }

  :where(.data-table-input:focus, .data-table-select:focus) {
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

  :where(.data-table-grip) {
    height: 4px;
    margin-top: -2px;
    cursor: row-resize;
    position: relative;
    z-index: 1;
  }

  :root.data-table-resizing {
    user-select: none;
    -webkit-user-select: none;
    cursor: row-resize;
  }

  ${Array.from(
    { length: MAX_HIDEABLE_COLUMNS },
    (_, index) =>
      `.data-table.data-table-hide-${index + 1} tr > :nth-child(${index + 1}) ` +
      `{ display: none; }`
  ).join("\n  ")}
`;

let stylesAdded = false;

function addDataTableStyles() {
  if (stylesAdded) {
    return;
  }
  stylesAdded = true;
  html.addStyleSheet(DATA_TABLE_STYLES);
}

// A row. `rowId` is what selection, windowing and `onRowClick` know it by.
export function tableRow(rowId, cells, { className, title } = {}) {
  const tr = document.createElement("tr");
  if (rowId != null) {
    tr.dataset.rowId = rowId;
  }
  if (className) {
    tr.className = className;
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
// commits, Escape restores, and a number cell commits only a number.
// `onCommit(value)` runs only for a changed, valid value.
export function editableCell({
  value,
  type = "text",
  step,
  round = false,
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
    if (event.key === "Enter") {
      input.blur();
    } else if (event.key === "Escape") {
      // A half-typed value left in the box would be written by the blur.
      input.value = String(committed);
      input.blur();
    }
  });
  input.addEventListener("change", () => {
    const parsed = parseCellValue(input.value, { type, round });
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
  select.className = className
    ? `data-table-select ${className}`
    : "data-table-select";
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

// Text that a double-click makes selectable, so a name can be copied out of a
// row without a drag across rows sweeping text along.
export function copyableText(text, { className } = {}) {
  const span = document.createElement("span");
  span.className = className ? `data-table-copyable ${className}` : "data-table-copyable";
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

  constructor() {
    super();
    addDataTableStyles();
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
    if (value) {
      this.scrollable = true;
    }
    if (this._grip) {
      this._grip.hidden = !value;
    }
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

    const table = html.createDomElement("table", { class: this._tableClasses() }, [
      thead,
      tbody,
    ]);
    this._table = table;
    this._tbody = tbody;
    table.classList.toggle("data-table-clickable", this._isClickable());

    this._scroll = html.div({ class: "data-table-scroll" }, [table]);
    this._scroll.addEventListener("scroll", () => this._scrolled());
    this._grip = html.div({ class: "data-table-grip" });
    this._grip.hidden = !this._resizable;
    this._grip.addEventListener("pointerdown", (event) => this._startResize(event));
    this.append(this._scroll, this._grip);

    this._applyColumnVisibility();
    this._updateSortHeaders();
  }

  _renderWindow() {
    if (!this._tbody || !this._items) {
      return;
    }
    this._tbody.textContent = "";
    const end = windowEnd(this._windowStart, this._items.length, this._windowSize);
    for (let index = this._windowStart; index < end; index++) {
      this._tbody.appendChild(this._renderRow(this._items[index], index));
    }
    this._applySelectedRows();
    if (this._selectable) {
      this._syncSelectAll();
    }
    this.onRowsRender?.();
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

  _startResize(event) {
    const grip = this._grip;
    const initialHeight = this._scroll.getBoundingClientRect().height;
    const initialY = event.clientY;
    let height;
    grip.setPointerCapture(event.pointerId);
    document.documentElement.classList.add("data-table-resizing");
    const onMove = (moveEvent) => {
      height = Math.max(this._minHeight, initialHeight + moveEvent.clientY - initialY);
      this._applyHeight(height);
    };
    const onEnd = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onEnd);
      grip.removeEventListener("lostpointercapture", onEnd);
      document.documentElement.classList.remove("data-table-resizing");
      if (height !== undefined && this._heightStorageKey) {
        try {
          localStorage.setItem(this._heightStorageKey, height);
        } catch {
          // The height still applies for this page.
        }
      }
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onEnd);
    grip.addEventListener("lostpointercapture", onEnd);
  }

  _showColumnMenu(event) {
    const hideable = this._columns.filter((column) => column.hideable && column.key);
    if (!hideable.length) {
      return;
    }
    event.preventDefault();
    showMenu(
      hideable.map((column) => ({
        title: column.label,
        checked: column.visible !== false,
        callback: () => {
          const visible = column.visible === false;
          if (this.onColumnToggle) {
            this.onColumnToggle(column.key, visible);
          } else {
            this.setColumnVisible(column.key, visible);
          }
        },
      })),
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
