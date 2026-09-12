import * as html from "@fontra/core/html-utils.js";

// Ticket 04 (UI-REFACTOR.md §3, UI-NOMENCLATURE.md §14): the shared table.
// Lifted out of the kerning view's pair table, which was the design: a
// sortable table head with a select-all tick, and row selection by click and
// shift-click. Cell rendering, loading and windowing stay the caller's; this
// component renders exactly the head it is told to and exactly the rows it
// is given.
//
// Deliberately plain light DOM, no shadow root. A caller's existing CSS is
// keyed to its own class names on the table/th/td/tr (the kerning view's
// kerning.css does this throughout), and a shadow root would silently break
// every one of those rules with no way to see it -- this change has no
// bundle/browser check available. UI-NOMENCLATURE.md §12 already flags
// shadow-DOM use as inconsistent across the shared components; this is one
// further deliberate exception, not a regression of a rule that was actually
// being enforced.
//
// Selection is by row identity: rows carry their own `data-row-id`, set by
// the caller's own row builders. This component only detects which row was
// clicked and with which modifier keys, and hands that off via `onRowClick` --
// interpreting shift/ctrl into a selection set is the caller's job, using
// whatever domain-agnostic selection module it already has (the kerning view
// has results-selection.js). That keeps this component ignorant of what a
// "row" means to any caller, kerning or otherwise.
export class DataTable extends HTMLElement {
  constructor() {
    super();
    this._columns = [];
    this._sortColumn = null;
    this._sortDirection = "asc";
    this._built = false;
    this.onSort = null;
    this.onSelectAllChange = null;
    this.onRowClick = null;
  }

  // Column descriptor shape: { label, sortKey, sortable, selectAll,
  // headerClassName }. `sortKey` is opaque to this component -- it is
  // whatever the caller passed back through `onSort`.
  set columns(columns) {
    this._columns = columns || [];
    this._build();
  }

  get columns() {
    return this._columns;
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
      this._table.className = name;
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
      if (column.sortable) {
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
          this.onSelectAllChange?.(checkbox.checked);
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

    const tbody = html.createDomElement("tbody", { id: this._tbodyId || "" });
    tbody.addEventListener("click", (event) => {
      if (event.target.closest("input, button")) {
        return;
      }
      const tr = event.target.closest("tr[data-row-id]");
      if (!tr) {
        return;
      }
      this.onRowClick?.(tr.dataset.rowId, event);
    });

    const table = html.createDomElement(
      "table",
      { class: this._tableClassName || "" },
      [thead, tbody]
    );
    this._table = table;
    this._tbody = tbody;
    this.appendChild(table);
    this._updateSortHeaders();
  }

  _updateSortHeaders() {
    for (const column of this._columns) {
      if (!column.sortable || !column._headerElement) {
        continue;
      }
      const isActive = column.sortKey === this._sortColumn;
      if (this._sortActiveClassName) {
        column._headerElement.classList.toggle(this._sortActiveClassName, isActive);
      }
      const arrow = isActive ? (this._sortDirection === "desc" ? " ▼" : " ▲") : "";
      column._labelElement.textContent = column.label + arrow;
    }
  }
}

customElements.define("data-table", DataTable);
