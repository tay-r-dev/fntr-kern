// The components gallery (Font menu > Components): every web component in
// each state it can be put in, one section per Figma component, so the whole
// set can be held against the design system in one place instead of hunted
// for across the app.
//
// The states a property or attribute sets (disabled, on, badge, selected,
// checked, ...) are drawn side by side. Hover, press and focus come from the
// pointer and the keyboard, which CSS cannot be told to fake, so every
// example stays live: hover and press it to see those.

import * as html from "@fontra/core/html-utils.js";
import "@fontra/web-components/add-remove-buttons.js";
import "@fontra/web-components/chain-link.js";
import "@fontra/web-components/input-field-large.js";
import {
  actionsCell,
  additionalText,
  editableCell,
  rowAction,
  statusSwatch,
  tableCell,
  tableRow,
} from "@fontra/web-components/data-table.js";
import "@fontra/web-components/icon-button.js";
import "@fontra/web-components/indication-badge.js";
import "@fontra/web-components/inline-svg.js";
import "@fontra/web-components/input-scrub.js";
import "@fontra/web-components/labeled-toggle.js";
import "@fontra/web-components/latch-button.js";
import "@fontra/web-components/link-button.js";
import "@fontra/web-components/modal-dialog.js";
import "@fontra/web-components/multi-select-dropdown.js";
import "@fontra/web-components/segmented-control.js";
import "@fontra/web-components/radio-buttons.js";
import "@fontra/web-components/slot-slider.js";
import { smolCSS, smolDropdown, smolEntry } from "@fontra/web-components/smol.js";
import "@fontra/web-components/text-button.js";
import "@fontra/web-components/ui-handle.js";
import "@fontra/web-components/ui-list.js";
import "@fontra/web-components/ui-text-input.js";

html.addStyleSheet(smolCSS());

const ICON = "arrows-horizontal";
const ICON_2 = "eye";
const ICON_3 = "lock";
const ICON_4 = "delete";

// A new element with `props` set as properties (the components' own
// convention: their states are JS properties, not attributes).
function make(tag, props = {}, attributes = {}) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  Object.assign(element, props);
  return element;
}

function cell(label, ...children) {
  return html.div({ class: "gallery-cell" }, [
    ...children,
    html.div({ class: "gallery-cell-label" }, [label]),
  ]);
}

function row(...cells) {
  return html.div({ class: "gallery-row" }, cells);
}

function section(title, source, ...rows) {
  return html.div({ class: "gallery-section" }, [
    html.div({ class: "gallery-section-title" }, [
      title,
      html.span({ class: "gallery-section-source" }, [source]),
    ]),
    ...rows,
  ]);
}

function textButtons() {
  return ["M", "S"].map((size) =>
    row(
      cell(`${size} rest`, make("text-button", { label: "label", size })),
      cell(`${size} icon`, make("text-button", { label: "label", size, icon: ICON })),
      cell(
        `${size} disabled`,
        make("text-button", { label: "label", size, disabled: true })
      )
    )
  );
}

function iconButtons(table) {
  const button = (props) => {
    const b = make("icon-button", { src: ICON, table, ...props });
    b.style.width = "24px";
    b.style.height = "24px";
    return b;
  };
  return row(
    cell("base", button()),
    cell("active", button({ on: true })),
    cell("disabled", button({ disabled: true })),
    cell("base, badge", button({ badge: true })),
    cell("active, badge", button({ on: true, badge: true })),
    cell("disabled, badge", button({ disabled: true, badge: true }))
  );
}

function latchButtons() {
  const button = (props) => make("latch-button", { src: ICON, ...props });
  return row(
    cell("off", button()),
    cell("on", button({ on: true })),
    cell("mixed", button({ mixed: true })),
    cell("badge", button({ badge: true })),
    cell("disabled", button({ disabled: true })),
    cell("on, disabled", button({ on: true, disabled: true }))
  );
}

function segmentedControls() {
  const options = () => [
    { value: "a", label: "both" },
    { value: "b", label: "left" },
    { value: "c", label: "right" },
  ];
  const control = (props, attributes) =>
    make("segmented-control", { options: options(), value: "a", ...props }, attributes);
  const partly = control();
  partly.options = [
    ...options().slice(0, 2),
    { value: "c", label: "right", disabled: true },
  ];
  return row(
    cell("rest", control()),
    cell("small", control({}, { small: "" })),
    cell("one option disabled", partly),
    cell("disabled", control({ disabled: true }))
  );
}

function toggles() {
  const toggle = (props) => make("labeled-toggle", { label: "label", ...props });
  return row(
    cell("off", toggle()),
    cell("on", toggle({ checked: true })),
    cell("off, disabled", toggle({ disabled: true })),
    cell("on, disabled", toggle({ checked: true, disabled: true }))
  );
}

function radioButtons() {
  const radios = (props) =>
    make("radio-buttons", {
      options: [
        { value: "a", label: "first" },
        { value: "b", label: "second" },
        { value: "c", label: "third" },
      ],
      value: "a",
      ...props,
    });
  return row(cell("rest", radios()), cell("disabled", radios({ disabled: true })));
}

function dropdowns() {
  const items = (checked) => [
    { value: "a", label: "first", checked: checked.includes("a") },
    { value: "b", label: "second", checked: checked.includes("b") },
    { value: "c", label: "third", checked: checked.includes("c") },
  ];
  const dropdown = (props) => {
    const d = make("multi-select-dropdown", { label: "preset", ...props });
    d.classList.add("gallery-field");
    return d;
  };
  const states = (labelAbove) =>
    row(
      cell("empty", dropdown({ labelAbove, items: items([]) })),
      cell("one pick", dropdown({ labelAbove, items: items(["b"]) })),
      cell("several picks", dropdown({ labelAbove, items: items(["a", "c"]) })),
      cell(
        "single choice",
        dropdown({ labelAbove, singleChoice: true, items: items(["b"]) })
      ),
      cell("disabled", dropdown({ labelAbove, items: items([]), disabled: true })),
      cell(
        "disabled, filled",
        dropdown({ labelAbove, items: items(["a"]), disabled: true })
      )
    );
  return [states(false), states(true)];
}

function textInputs() {
  const input = (props) => {
    const i = make("ui-text-input", props);
    i.classList.add("gallery-field");
    return i;
  };
  return row(
    cell("hint", input({ placeholder: "hint" })),
    cell("value", input({ value: "value" })),
    cell("disabled", input({ value: "value", disabled: true })),
    cell("multiline", input({ multiline: true, value: "one\ntwo" }))
  );
}

function scrubFields() {
  const field = (props) => {
    const f = make("input-field-large", { label: "label", value: 12, ...props });
    f.classList.add("gallery-field");
    return f;
  };
  const slider = (props) =>
    field({ type: "slider", minValue: 0, maxValue: 100, value: 40, ...props });
  return [
    row(
      cell("scrub", field()),
      cell("number", field({ type: "number" })),
      cell("text", field({ type: "text", value: "=H" })),
      cell("mixed", field({ mixed: true })),
      cell("disabled", field({ disabled: true }))
    ),
    row(cell("slider", slider()), cell("slider, disabled", slider({ disabled: true }))),
  ];
}

// smol (Figma 4102:1607): the entry and the dropdown, plain and selected.
// Hover and focus show on the pointer and the keyboard.
function smols() {
  const options = [
    { value: "entry", label: "entry" },
    { value: "other", label: "other" },
  ];
  const dropdown = (className) => smolDropdown({ value: "entry", options, className });
  return row(
    cell("entry", smolEntry({ value: "entry" })),
    cell("entry, select", smolEntry({ value: "entry", className: "select" })),
    cell("dropdown", dropdown()),
    cell("dropdown, select", dropdown("select"))
  );
}

function scrubPairs() {
  const pair = (props) => {
    const p = make("ui-input-scrub", {
      leftLabel: "L",
      rightLabel: "R",
      leftValue: 10,
      rightValue: 20,
      ...props,
    });
    p.classList.add("gallery-wide");
    return p;
  };
  return row(
    cell("linked", pair({ link: "on" })),
    cell("unlinked", pair({ link: "off" })),
    cell("disabled", pair({ link: "off", disabled: true }))
  );
}

function links() {
  return row(
    cell("link on", make("ui-link-button", { state: "on" })),
    cell("link off", make("ui-link-button", { state: "off" })),
    cell("link disabled", make("ui-link-button", { state: "on", disabled: true })),
    cell("chain closed", make("chain-link", { linked: true })),
    cell("chain open", make("chain-link", { linked: false })),
    cell("chain mixed", make("chain-link", { linked: null })),
    cell("chain disabled", make("chain-link", { linked: true, disabled: true }))
  );
}

function slotSliders() {
  const slider = (props) => {
    const s = make("slot-slider", { min: 0, max: 100, stops: [0, 50, 100], ...props });
    s.classList.add("gallery-field");
    return s;
  };
  return row(
    cell("in a slot", slider({ value: 50 })),
    cell("between slots", slider({ value: 30 })),
    cell("disabled", slider({ value: 30, disabled: true }))
  );
}

function badgesAndHandles() {
  return row(
    cell("badge M inside", make("indication-badge", { size: "M", state: "inside" })),
    cell("badge M outside", make("indication-badge", { size: "M", state: "outside" })),
    cell("badge S inside", make("indication-badge", { size: "S", state: "inside" })),
    cell("badge S outside", make("indication-badge", { size: "S", state: "outside" })),
    cell("handle M", make("ui-handle", { size: "M" })),
    cell("handle S", make("ui-handle", { size: "S" }))
  );
}

function addRemove() {
  return row(
    cell("icons", make("add-remove-buttons", {})),
    cell("text", make("add-remove-buttons", { textButtons: true })),
    cell(
      "text, remove disabled",
      make("add-remove-buttons", { textButtons: true, disableRemoveButton: true })
    )
  );
}

// Every row type and state of the table (Figma 2004:29827): rest, selected
// (two in a row, so the lines between selected rows show), disabled, marked;
// with an entry and its additional info, an editable entry, a status swatch,
// a row icon and the action icons.
const TABLE_ITEMS = [
  { id: "rest", name: "rest" },
  { id: "marked", name: "marked", marker: true },
  { id: "selected-1", name: "selected" },
  { id: "selected-2", name: "selected, marked", marker: true },
  { id: "active", name: "active icon", active: true },
  { id: "badge", name: "badged icon", badge: true },
  { id: "selected-3", name: "selected, active icon", active: true },
  { id: "disabled", name: "disabled", disabled: true },
  { id: "last", name: "rest" },
];

function dataTable(look) {
  const table = make("data-table", {});
  table.columns = [
    { label: "entry", key: "entry" },
    { label: "editable", key: "editable" },
    { label: "custom", key: "custom" },
    { label: "", key: "actions" },
  ];
  table.look = look;
  table.selectable = true;
  table.classList.add("gallery-wide");
  table.style.width = "520px";
  table.setRows(
    TABLE_ITEMS,
    (item) =>
      tableRow(
        item.id,
        [
          tableCell([
            item.name,
            additionalText("additional info"),
            rowAction({ src: ICON, tooltip: "row icon", reveal: "dim" }),
          ]),
          tableCell([editableCell({ value: "entry", disabled: item.disabled })]),
          tableCell([statusSwatch("#f4c3cb")]),
          actionsCell(
            [ICON_2, ICON_3, ICON_4, ICON].map((src, index) => {
              const action = rowAction({ src, tooltip: "action", reveal: "hover" });
              action.on = !!item.active && index === 0;
              action.badge = !!item.badge && index === 0;
              return action;
            })
          ),
        ],
        { marker: item.marker, disabled: item.disabled }
      ),
    { rowId: (item) => item.id }
  );
  table.setSelectedRows(["selected-1", "selected-2", "selected-3"]);
  return table;
}

function dataTables() {
  return row(
    cell('look "select": every row ruled', dataTable("select")),
    cell('look "data": selected rows ruled', dataTable("data"))
  );
}

function uiList(look) {
  const list = make("ui-list", {});
  list.setAttribute("look", look);
  list.showHeader = true;
  list.columnDescriptions = [
    {
      title: "",
      key: "icon",
      width: "16px",
      cellFactory: () => make("inline-svg", { src: ICON_2 }),
    },
    { title: "name", key: "name", width: "160px" },
  ];
  list.style.width = "240px";
  list.style.height = "180px";
  list.setItems([
    { name: "rest" },
    { name: "selected" },
    { name: "rest" },
    { name: "disabled", disabled: true },
    { name: "rest" },
  ]);
  list.setSelectedItemIndex(1);
  return list;
}

function uiLists() {
  return row(
    cell('look "select"', uiList("select")),
    cell('look "data"', uiList("data"))
  );
}

export function buildComponentsGallery(container) {
  container.append(
    html.div({ class: "gallery-note" }, [
      "Every component in each state a property can set. Hover, press and " +
        "focus are live: point at and press the examples to see them.",
    ]),
    section("button/text", "Figma 414:31310", ...textButtons()),
    section("button/icon", "Figma 2004:29230", iconButtons(false)),
    section(
      "button/table",
      "Figma 4054:1391 — the select variant is in the tables' selected rows below",
      iconButtons(true)
    ),
    section("button/latch", "Figma 287:15701", latchButtons()),
    section("select/segmented", "Figma 2004:29330", segmentedControls()),
    section("select/toggle", "Figma 2004:29380", toggles()),
    section("select/radio", "radio-buttons, the checkmark made round", radioButtons()),
    section(
      "select/dropdown",
      "Figma 2004:29427 field, 2004:29458 with its label above, 2004:29483 menu",
      ...dropdowns()
    ),
    section("input/text", "Figma 2004:29656", textInputs()),
    section(
      "input/field",
      "Figma 2004:29576, 2004:29534, 2004:29608",
      ...scrubFields()
    ),
    section("input/smol", "Figma 4102:1607 (smol.js)", smols()),
    section("input/scrub pair", "input-scrub", scrubPairs()),
    section("link, chain", "link-button, chain-link", links()),
    section("slot slider", "Figma 421:15034, 421:15066", slotSliders()),
    section("badge, handle", "Figma 287:15770, 379:22492", badgesAndHandles()),
    section("add / remove", "Figma 421:12727", addRemove()),
    section("table", "Figma 2004:29827 (data-table)", dataTables()),
    section("table", "Figma 2004:29827 (ui-list)", uiLists())
  );
}
